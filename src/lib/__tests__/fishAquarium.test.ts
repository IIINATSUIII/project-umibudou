import { describe, expect, it } from 'vitest'
import {
  CUTOUT_INPUT_SIZE,
  MAX_COVERAGE,
  MIN_COVERAGE,
  SPRITE_MAX_SIDE,
  boundingBox,
  centerCropBox,
  coverageOf,
  isUsableCutout,
  judgeCutout,
  normalizeMap,
  spriteSize,
  toAlpha,
} from '../fish/cutout'
import {
  FULL_GROWN_FED,
  GROWTH_STAGES,
  MAX_FOOD,
  MAX_GROWTH_SCALE,
  MAX_POOP,
  MIN_GROWTH_SCALE,
  addPoops,
  createFish,
  dropFood,
  facing,
  foodUntilNextStage,
  growthScale,
  growthStage,
  hitPoop,
  hitTest,
  nearestFood,
  removePoop,
  spinScale,
  step,
  stepPoops,
  wobbleOffset,
  type Food,
  type Poop,
  type SwimmingFish,
  type TankSize,
} from '../fish/aquariumSim'

const tank: TankSize = { width: 400, height: 500, floor: 50 }

/** 同じ順番で、同じ値を返す乱数（テストで結果が変わらないように） */
function seeded(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

describe('切り抜きの判定', () => {
  it('マップを0〜1にそろえる。全部同じ値なら、全部0（魚なし）', () => {
    expect(Array.from(normalizeMap([2, 4, 6]))).toEqual([0, 0.5, 1])
    expect(Array.from(normalizeMap([3, 3, 3]))).toEqual([0, 0, 0])
    expect(normalizeMap([])).toHaveLength(0)
  })

  it('透明度: 低いところは透明、高いところは不透明、間はなめらか', () => {
    expect(toAlpha(0)).toBe(0)
    expect(toAlpha(0.35)).toBe(0)
    expect(toAlpha(0.5)).toBe(128)
    expect(toAlpha(0.65)).toBe(255)
    expect(toAlpha(1)).toBe(255)
    expect(toAlpha(0.45)).toBeGreaterThan(toAlpha(0.4))
  })

  it('魚が占める割合を数え、小さすぎ・大きすぎは「失敗」にする', () => {
    expect(coverageOf([])).toBe(0)
    expect(coverageOf([0.9, 0.9, 0.1, 0.1])).toBe(0.5)
    expect(isUsableCutout(0.2)).toBe(true)
    expect(isUsableCutout(MIN_COVERAGE)).toBe(true)
    expect(isUsableCutout(MIN_COVERAGE - 0.001)).toBe(false)
    expect(isUsableCutout(MAX_COVERAGE + 0.001)).toBe(false)
    expect(isUsableCutout(0)).toBe(false)
  })

  it('魚を囲む四角を余白つきで求める。魚がなければ null', () => {
    const w = 10
    const h = 10
    const map = new Float32Array(w * h)
    for (let y = 3; y <= 5; y++) for (let x = 2; x <= 6; x++) map[y * w + x] = 1

    const box = boundingBox(map, w, h, 0)
    expect(box).toEqual({ x: 2, y: 3, width: 5, height: 3 })
    const padded = boundingBox(map, w, h, 0.5)!
    expect(padded.x).toBeLessThan(2)
    expect(padded.width).toBeGreaterThan(5)
    expect(boundingBox(new Float32Array(w * h), w, h)).toBeNull()
  })

  it('余白をつけても、画像の外にはみ出さない', () => {
    const map = new Float32Array(100).fill(1)
    const box = boundingBox(map, 10, 10, 0.5)!

    expect(box).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })

  it('切り抜きの大きさ: 小さいものは拡大せず、大きいものは長い辺をそろえる', () => {
    expect(spriteSize(100, 80)).toEqual({ width: 100, height: 80 })
    expect(spriteSize(1024, 512)).toEqual({ width: SPRITE_MAX_SIDE, height: SPRITE_MAX_SIDE / 2 })
    expect(spriteSize(10000, 1).height).toBeGreaterThanOrEqual(1)
  })

  it('2回目に使う範囲は、中央の60%', () => {
    expect(centerCropBox(100, 200)).toEqual({ x: 20, y: 40, width: 60, height: 120 })
    expect(CUTOUT_INPUT_SIZE).toBe(320)
  })
})

describe('judgeCutout(切り抜きが、魚を切り抜けていそうか)', () => {
  it('切り抜きでも同じ魚が1位で、確率が元の3割以上なら、ok', () => {
    expect(judgeCutout(5, 0.9, 5, 0.9)).toBe('ok')
    expect(judgeCutout(5, 0.9, 5, 0.27)).toBe('ok') // ちょうど3割
  })

  it('確率が元の3割に満たなければ、疑わしい', () => {
    expect(judgeCutout(5, 0.9, 5, 0.26)).toBe('doubtful')
  })

  it('切り抜きで別の魚が1位になったら、疑わしい（サンゴなど、背景だけを切り抜いたとき）', () => {
    expect(judgeCutout(5, 0.99, 12, 0.9)).toBe('doubtful')
  })

  it('魚の種類がわからないときは、確かめられない', () => {
    expect(judgeCutout(null, 0.4, 3, 0.8)).toBe('unknown')
  })
})

describe('水槽の動き: 魚', () => {
  it('作った魚は、水槽の中にいて、大きさは水槽に合い、向きは左右どちらか', () => {
    const random = seeded(7)
    for (let i = 0; i < 50; i++) {
      const fish = createFish(`f${i}`, tank, random)
      expect(fish.x).toBeGreaterThan(0)
      expect(fish.x).toBeLessThan(tank.width)
      expect(fish.y).toBeGreaterThan(0)
      expect(fish.y).toBeLessThan(tank.height - tank.floor)
      expect(fish.size).toBeGreaterThan(40)
      expect(Math.abs(fish.vx)).toBeGreaterThan(0)
    }
  })

  it('10分間泳がせても、魚は水槽の中から出ない（壁で向きを変える）', () => {
    const random = seeded(3)
    let fishes: SwimmingFish[] = Array.from({ length: 8 }, (_, i) => createFish(`f${i}`, tank, random))
    for (let t = 0; t < 600 * 60; t++) {
      fishes = step(fishes, [], tank, 1 / 60, random).fishes
      for (const f of fishes) {
        if (f.x < f.size / 2 - 0.001 || f.x > tank.width - f.size / 2 + 0.001 || f.y < 0 || f.y > tank.height - tank.floor) {
          throw new Error(`外に出た: ${JSON.stringify(f)} (t=${t})`)
        }
      }
    }
    expect(fishes).toHaveLength(8)
  })

  it('壁にぶつかると、向きが反対になる', () => {
    const random = seeded(1)
    const fish: SwimmingFish = { ...createFish('a', tank, random), x: tank.width - 5, vx: 60 }

    const [after] = step([fish], [], tank, 0.05, random).fishes

    expect(after.vx).toBeLessThan(0)
    expect(facing(after)).toBe(-1)
  })

  it('向き: 右に進めば1、左に進めば-1', () => {
    const base = createFish('a', tank, seeded(1))
    expect(facing({ ...base, vx: 30 })).toBe(1)
    expect(facing({ ...base, vx: -30 })).toBe(-1)
  })

  it('元の魚・エサのオブジェクトは変えない', () => {
    const random = seeded(2)
    const fish = createFish('a', tank, random)
    const snapshot = JSON.stringify(fish)
    const foods: Food[] = [{ id: 1, x: 100, y: 100 }]
    const foodSnapshot = JSON.stringify(foods)

    step([fish], foods, tank, 0.016, random)

    expect(JSON.stringify(fish)).toBe(snapshot)
    expect(JSON.stringify(foods)).toBe(foodSnapshot)
  })

  it('長い停止（タブが裏に回ったあとなど）から戻っても、魚が飛ばない', () => {
    const random = seeded(4)
    const fish = createFish('a', tank, random)

    const [after] = step([fish], [], tank, 60, random).fishes

    expect(Math.abs(after.x - fish.x)).toBeLessThan(15)
  })

  it('ゆらぎと回転の値は、範囲内に収まる', () => {
    const fish = createFish('a', tank, seeded(1))
    for (let w = 0; w < 20; w += 0.3) {
      expect(Math.abs(wobbleOffset({ ...fish, wobble: w }))).toBeLessThanOrEqual(fish.size * 0.05 + 1.5)
    }
    expect(spinScale({ ...fish, spin: 0 })).toBe(1)
    for (let s = 0.01; s <= 0.6; s += 0.05) {
      const v = spinScale({ ...fish, spin: s })
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('水槽の動き: エサ', () => {
  it('エサを落とすと増える。上限を超えては落とせない。水の外には落とさない', () => {
    let foods: Food[] = []
    for (let i = 0; i < MAX_FOOD + 3; i++) foods = dropFood(foods, 100 + i, 50, tank, i)
    expect(foods).toHaveLength(MAX_FOOD)

    const edge = dropFood([], -50, 9999, tank, 1)[0]
    expect(edge.x).toBe(8)
    expect(edge.y).toBeLessThanOrEqual(tank.height - tank.floor)
  })

  it('一番近いエサを選ぶ。なければ null', () => {
    const fish: SwimmingFish = { ...createFish('a', tank, seeded(1)), x: 100, y: 100 }
    expect(nearestFood(fish, [])).toBeNull()
    expect(nearestFood(fish, [{ id: 1, x: 300, y: 300 }, { id: 2, x: 110, y: 100 }])?.id).toBe(2)
  })

  it('エサを落とすと、魚が近づいて食べ、エサはなくなり、食べた魚が回る', () => {
    const random = seeded(5)
    let fishes: SwimmingFish[] = [{ ...createFish('a', tank, random), x: 80, y: 150, vx: 40 }]
    let foods: Food[] = [{ id: 1, x: 260, y: 200 }]
    const startDistance = Math.hypot(260 - 80, 200 - 150)
    let ate = false
    let spun = false

    for (let t = 0; t < 600 && foods.length > 0; t++) {
      const result = step(fishes, foods, tank, 1 / 60, random)
      fishes = result.fishes
      foods = result.foods
      if (t === 20) expect(Math.hypot(260 - fishes[0].x, 200 - fishes[0].y)).toBeLessThan(startDistance)
      if (result.eaten.length) ate = true
      if (fishes[0].spin > 0) spun = true
    }

    expect(ate).toBe(true)
    expect(spun).toBe(true)
    expect(foods).toHaveLength(0)
  })

  it('エサは、誰にも食べられなければ沈み、底に着くとなくなる', () => {
    let foods: Food[] = [{ id: 1, x: 200, y: 20 }]
    const random = seeded(1)
    const y0 = foods[0].y

    foods = step([], foods, tank, 0.1, random).foods
    expect(foods[0].y).toBeGreaterThan(y0)

    for (let t = 0; t < 60 * 20 && foods.length; t++) foods = step([], foods, tank, 1 / 60, random).foods
    expect(foods).toHaveLength(0)
  })

  it('エサは、1つを2匹が食べることはない（食べられた分は、その場でなくなる）', () => {
    const random = seeded(6)
    const near = (id: string): SwimmingFish => ({ ...createFish(id, tank, random), x: 200, y: 200 })
    const result = step([near('a'), near('b')], [{ id: 1, x: 200, y: 200 }], tank, 0.016, random)

    expect(result.eaten).toEqual(['a']) // 先に来た1匹だけが食べる。2匹目は、食べられたエサを追わない
    expect(result.foods).toHaveLength(0) // 食べられたエサは、なくなる
  })
})

describe('タップの当たり判定', () => {
  const fish = (id: string, x: number, y: number): SwimmingFish => ({ ...createFish(id, tank, seeded(1)), id, x, y, size: 80 })

  it('魚の上をタップすると、その魚。外すと null', () => {
    const fishes = [fish('a', 100, 100)]
    expect(hitTest(fishes, 105, 102)?.id).toBe('a')
    expect(hitTest(fishes, 300, 300)).toBeNull()
  })

  it('指で触りやすいよう、見た目より少し広く判定する', () => {
    const fishes = [fish('a', 100, 100)]
    expect(hitTest(fishes, 100 + 40 + 5, 100)).not.toBeNull()
    expect(hitTest(fishes, 100 + 40 + 20, 100)).toBeNull()
  })

  it('重なっているときは、手前（後ろに描く魚）を選ぶ', () => {
    const fishes = [fish('back', 100, 100), fish('front', 105, 100)]
    expect(hitTest(fishes, 102, 100)?.id).toBe('front')
  })

  it('魚がいない水槽では、いつも null', () => {
    expect(hitTest([], 10, 10)).toBeNull()
  })
})

describe('成長: エサを食べた数で大きくなる', () => {
  it('倍率は、食べていなければ小さく、食べるほど大きく、育ちきったら止まる', () => {
    expect(growthScale(0)).toBeCloseTo(MIN_GROWTH_SCALE)
    expect(growthScale(FULL_GROWN_FED)).toBeCloseTo(MAX_GROWTH_SCALE)
    expect(growthScale(FULL_GROWN_FED * 5)).toBeCloseTo(MAX_GROWTH_SCALE)
    expect(growthScale(10)).toBeGreaterThan(growthScale(5))
    expect(growthScale(-3)).toBeCloseTo(MIN_GROWTH_SCALE) // 壊れた値でも、範囲に収める
    expect(growthScale(Number.NaN)).toBeCloseTo(MIN_GROWTH_SCALE)
  })

  it('段階: 食べた数が境目に達すると上がる。次の段階までの数も出せる', () => {
    expect(growthStage(0)).toBe(0)
    expect(growthStage(GROWTH_STAGES[1].from - 1)).toBe(0)
    expect(growthStage(GROWTH_STAGES[1].from)).toBe(1)
    expect(growthStage(999)).toBe(GROWTH_STAGES.length - 1)
    expect(foodUntilNextStage(2)).toBe(GROWTH_STAGES[1].from - 2)
    expect(foodUntilNextStage(999)).toBeNull()
  })

  it('食べた数が多い魚は、最初から大きく泳ぎ始める（保存された数から再開する）', () => {
    const baby = createFish('a', tank, seeded(3), 0)
    const grown = createFish('a', tank, seeded(3), FULL_GROWN_FED)
    expect(grown.baseSize).toBe(baby.baseSize)
    expect(grown.size).toBeGreaterThan(baby.size)
    expect(grown.fed).toBe(FULL_GROWN_FED)
  })

  it('エサを食べると、食べた数が1つ増え、大きさが少しずつ成長に追いつく', () => {
    const random = seeded(9)
    let fishes: SwimmingFish[] = [{ ...createFish('a', tank, random, 0), x: 200, y: 200 }]
    const before = fishes[0].size
    const result = step(fishes, [{ id: 1, x: 200, y: 200 }], tank, 0.016, random)
    expect(result.eaten).toEqual(['a'])
    fishes = result.fishes
    expect(fishes[0].fed).toBe(1)

    // 食べた数を一気に増やしておくと、時間がたつにつれて、目標の大きさに近づく
    fishes = [{ ...fishes[0], fed: FULL_GROWN_FED }]
    const target = fishes[0].baseSize * MAX_GROWTH_SCALE
    let last = before
    for (let t = 0; t < 120; t++) {
      fishes = step(fishes, [], tank, 1 / 60, random).fishes
      expect(fishes[0].size).toBeGreaterThanOrEqual(last - 1e-9) // 縮まない
      last = fishes[0].size
    }
    expect(last).toBeGreaterThan(before)
    expect(last).toBeCloseTo(target, 0)
  })
})

describe('うんち', () => {
  /** 1匹がエサを n 個食べたあと、しばらく様子を見る */
  function feed(count: number, seconds: number) {
    const random = seeded(11)
    let fishes: SwimmingFish[] = [{ ...createFish('a', tank, random), x: 200, y: 200, vx: 40 }]
    for (let i = 0; i < count; i++) fishes = step(fishes, [{ id: i + 1, x: fishes[0].x, y: fishes[0].y }], tank, 0.016, random).fishes
    const dropped: { x: number; y: number }[] = []
    for (let t = 0; t < seconds * 60; t++) {
      const result = step(fishes, [], tank, 1 / 60, random)
      fishes = result.fishes
      dropped.push(...result.dropped)
    }
    return { fishes, dropped }
  }

  it('何も食べていない魚は、うんちをしない', () => {
    expect(feed(0, 60).dropped).toHaveLength(0)
  })

  it('エサを食べた数だけ、しばらくしてから、うんちが出る（食べてすぐは出ない）', () => {
    expect(feed(1, 3).dropped).toHaveLength(0) // 消化には時間がかかる
    const result = feed(3, 80)
    expect(result.dropped).toHaveLength(3)
    expect(result.fishes[0].digesting).toBe(0) // 出し終わったら、それ以上は出ない
    expect(feed(3, 200).dropped).toHaveLength(3)
  })

  it('うんちは、魚の後ろ（しっぽ側）から出る', () => {
    const random = seeded(2)
    const fish: SwimmingFish = { ...createFish('a', tank, random), x: 200, y: 200, vx: 40, digesting: 1, poopIn: 0 }
    const right = step([fish], [], tank, 0.016, random).dropped[0]
    expect(right.x).toBeLessThan(fish.x) // 右向きなら、左（後ろ）
    const left = step([{ ...fish, vx: -40 }], [], tank, 0.016, random).dropped[0]
    expect(left.x).toBeGreaterThan(fish.x)
  })

  it('うんちは、ゆっくり沈み、底に着くと止まる。着く高さは水槽の底（砂）の中', () => {
    let poops: Poop[] = addPoops([], [{ x: 100, y: 100 }], tank, 1)
    const y0 = poops[0].y
    poops = stepPoops(poops, tank, 0.1)
    expect(poops[0].y).toBeGreaterThan(y0)
    expect(poops[0].settled).toBe(false)

    for (let t = 0; t < 60 * 30; t++) poops = stepPoops(poops, tank, 1 / 60)
    expect(poops[0].settled).toBe(true)
    expect(poops[0].y).toBeGreaterThanOrEqual(tank.height - tank.floor)
    expect(poops[0].y).toBeLessThanOrEqual(tank.height)
    const rest = poops[0].y
    expect(stepPoops(poops, tank, 0.1)[0].y).toBe(rest) // 着いたら、動かない
  })

  it('元の配列は変えない', () => {
    const poops: Poop[] = [{ id: 1, x: 10, y: 10, settled: false }]
    stepPoops(poops, tank, 0.1)
    expect(poops[0].y).toBe(10)
  })

  it('たまるうんちには上限があり、あふれたら古いものから消える。水の外には出さない', () => {
    let poops: Poop[] = []
    for (let i = 0; i < MAX_POOP + 5; i++) poops = addPoops(poops, [{ x: -50, y: 99999 }], tank, i + 1)
    expect(poops).toHaveLength(MAX_POOP)
    expect(poops[0].id).toBe(6) // 古い5つが消えた
    expect(poops[0].x).toBe(8)
    expect(poops[0].y).toBeLessThanOrEqual(tank.height - tank.floor)
  })

  it('タップで、いちばん近いうんちを見つけ、そうじできる。外れたら null', () => {
    const poops: Poop[] = [
      { id: 1, x: 100, y: 440, settled: true },
      { id: 2, x: 110, y: 440, settled: true },
    ]
    expect(hitPoop(poops, 300, 100)).toBeNull()
    expect(hitPoop(poops, 108, 440)?.id).toBe(2)
    expect(removePoop(poops, 2).map((p) => p.id)).toEqual([1])
    expect(removePoop(poops, 99)).toHaveLength(2)
  })
})
