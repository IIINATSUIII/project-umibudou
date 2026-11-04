/**
 * 水槽の中の魚の動き（位置・向き・ゆらぎ・エサへの寄り方・タップの当たり判定）。
 * 描画（canvas）には依存しない。乱数は差し替えられる（テストで同じ結果になるように）。
 *
 * 座標は、水槽の左上を (0, 0) とする、px。
 */

export interface TankSize {
  width: number
  height: number
  /** 底の砂の高さ。魚はここより下には行かない */
  floor: number
}

export interface SwimmingFish {
  /** 記録の id */
  id: string
  x: number
  y: number
  /** 横の速さ（px/秒）。マイナスは左向き */
  vx: number
  /** 縦の速さ（px/秒） */
  vy: number
  /** いまの表示の大きさ（px。長い辺）。成長に合わせて、少しずつ変わる */
  size: number
  /** 成長する前の、基準の大きさ（px）。実際の大きさは、これに成長の倍率をかけたもの */
  baseSize: number
  /** これまでに食べたエサの数（成長のもと。記録に保存される） */
  fed: number
  /** まだ消化していないエサの数。うんちとして出てくる */
  digesting: number
  /** 次のうんちまでの秒数 */
  poopIn: number
  /** 上下のゆらぎの位相（ラジアン） */
  wobble: number
  /** 回転（くるっと回る動き）の残り秒数。0なら回っていない */
  spin: number
  /** 次に、泳ぐ高さをえらびなおすまでの秒数 */
  retargetIn: number
  /** 狙っている高さ */
  targetY: number
}

export interface Food {
  id: number
  x: number
  y: number
}

/** 水槽の底に落ちていくうんち。底に着いたら、そうじするまで残る */
export interface Poop {
  id: number
  x: number
  y: number
  /** 底に着いたか */
  settled: boolean
}

export type Random = () => number

// ---- 成長: エサを食べた数で、大きくなる ----
/** 生まれたての大きさと、育ちきったときの大きさ（基準の大きさに対する倍率） */
export const MIN_GROWTH_SCALE = 0.7
export const MAX_GROWTH_SCALE = 1.3
/** この数だけ食べると、育ちきる */
export const FULL_GROWN_FED = 40
/** 成長の段階の名前と、その段階になるエサの数 */
export const GROWTH_STAGES = [
  { name: 'あかちゃん', from: 0 },
  { name: 'こども', from: 5 },
  { name: 'おとな', from: 15 },
  { name: 'ベテラン', from: 30 },
] as const

/** 食べたエサの数から、大きさの倍率（0.7〜1.3）。 */
export function growthScale(fed: number): number {
  const ratio = clamp(Number.isFinite(fed) ? fed : 0, 0, FULL_GROWN_FED) / FULL_GROWN_FED
  return MIN_GROWTH_SCALE + (MAX_GROWTH_SCALE - MIN_GROWTH_SCALE) * ratio
}

/** 成長の段階（0〜3）。 */
export function growthStage(fed: number): number {
  let stage = 0
  GROWTH_STAGES.forEach((s, index) => {
    if (fed >= s.from) stage = index
  })
  return stage
}

/** 次の段階まで、あと何個か。いちばん上の段階なら null。 */
export function foodUntilNextStage(fed: number): number | null {
  const next = GROWTH_STAGES[growthStage(fed) + 1]
  return next ? next.from - fed : null
}

// ---- うんち ----
/** 食べてから、うんちを出すまでの秒数の範囲 */
const DIGEST_MIN = 6
const DIGEST_MAX = 14
const POOP_SINK_SPEED = 24
/** 水槽に残るうんちの上限（古いものから消す）。描画を軽く保つ */
export const MAX_POOP = 16
/** うんちのタップの当たり判定の半径（指で触りやすいように、見た目より広く） */
const POOP_HIT_RADIUS = 18

/** 通常の泳ぐ速さ（px/秒）の範囲。大きい魚ほど、ゆっくり */
const MIN_SPEED = 28
const MAX_SPEED = 78
/** エサに向かうときの速さ（px/秒） */
const FOOD_SPEED = 120
const SINK_SPEED = 38
/** 大きさが成長に追いつく速さ（1秒あたりの割合） */
const GROW_RATE = 2.5
export const MAX_FOOD = 6
const EAT_DISTANCE = 18
/** タップの当たり判定の余白（指で触りやすいように） */
const HIT_PADDING = 10

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 魚の表示の大きさ。水槽の大きさに合わせる。 */
export function fishSizeFor(tank: TankSize, random: Random): number {
  const base = Math.min(tank.width, tank.height)
  return Math.round(base * (0.16 + random() * 0.1))
}

export function createFish(id: string, tank: TankSize, random: Random, fed = 0): SwimmingFish {
  const baseSize = fishSizeFor(tank, random)
  const size = Math.round(baseSize * growthScale(fed))
  const speed = MAX_SPEED - (baseSize / Math.max(1, Math.min(tank.width, tank.height))) * (MAX_SPEED - MIN_SPEED) * 2.2
  const direction = random() < 0.5 ? -1 : 1
  const minY = size / 2 + 8
  const maxY = Math.max(minY + 1, tank.height - tank.floor - size / 2)
  const y = minY + random() * (maxY - minY)
  return {
    id,
    x: size / 2 + random() * Math.max(1, tank.width - size),
    y,
    vx: direction * clamp(speed, MIN_SPEED, MAX_SPEED),
    vy: 0,
    size,
    baseSize,
    fed: Math.max(0, Math.floor(fed)),
    digesting: 0,
    poopIn: 0,
    wobble: random() * Math.PI * 2,
    spin: 0,
    retargetIn: 3 + random() * 5,
    targetY: y,
  }
}

/** 向き。右向きなら 1、左向きなら -1。 */
export function facing(fish: SwimmingFish): 1 | -1 {
  return fish.vx < 0 ? -1 : 1
}

/** 一番近いエサ。なければ null。 */
export function nearestFood(fish: SwimmingFish, foods: readonly Food[]): Food | null {
  let best: Food | null = null
  let bestDistance = Infinity
  for (const food of foods) {
    const d = Math.hypot(food.x - fish.x, food.y - fish.y)
    if (d < bestDistance) {
      best = food
      bestDistance = d
    }
  }
  return best
}

/** エサを落とす（上限 MAX_FOOD つまで）。落とした場所は、水の中に収める。 */
export function dropFood(foods: readonly Food[], x: number, y: number, tank: TankSize, nextId: number): Food[] {
  if (foods.length >= MAX_FOOD) return [...foods]
  return [...foods, { id: nextId, x: clamp(x, 8, tank.width - 8), y: clamp(y, 8, tank.height - tank.floor - 4) }]
}

/**
 * dt 秒だけ時間を進める。魚を更新したものと、食べられずに残ったエサを返す。元の配列・オブジェクトは変えない。
 */
export function step(
  fishes: readonly SwimmingFish[],
  foods: readonly Food[],
  tank: TankSize,
  dt: number,
  random: Random
): { fishes: SwimmingFish[]; foods: Food[]; eaten: string[]; dropped: { x: number; y: number }[] } {
  const eatenFoodIds = new Set<number>()
  const eatenBy: string[] = []
  const dropped: { x: number; y: number }[] = []
  const stepDt = clamp(dt, 0, 0.1) // 長い間の停止（タブが裏に回ったときなど）で、魚が飛ばないように

  const next = fishes.map((fish) => {
    const target = nearestFood(fish, foods.filter((f) => !eatenFoodIds.has(f.id)))
    let { x, y, vx, vy, wobble, spin, retargetIn, targetY, size, fed, digesting, poopIn } = fish
    wobble += stepDt * 2.4
    // 成長した分だけ、少しずつ大きくなる
    const targetSize = fish.baseSize * growthScale(fed)
    size += (targetSize - size) * Math.min(1, GROW_RATE * stepDt)
    if (Math.abs(targetSize - size) < 0.05) size = targetSize
    spin = Math.max(0, spin - stepDt)

    if (target) {
      // エサに向かう
      const dx = target.x - x
      const dy = target.y - y
      const distance = Math.hypot(dx, dy) || 1
      vx = (dx / distance) * FOOD_SPEED
      vy = (dy / distance) * FOOD_SPEED
      if (distance < EAT_DISTANCE) {
        eatenFoodIds.add(target.id)
        eatenBy.push(fish.id)
        spin = 0.6
        fed += 1
        if (digesting === 0) poopIn = DIGEST_MIN + random() * (DIGEST_MAX - DIGEST_MIN)
        digesting += 1
      }
    } else {
      // ふだんの泳ぎ: 横にまっすぐ、高さはときどき選びなおして、ゆるやかに近づく
      retargetIn -= stepDt
      if (retargetIn <= 0) {
        const minY = fish.size / 2 + 8
        const maxY = Math.max(minY + 1, tank.height - tank.floor - fish.size / 2)
        targetY = minY + random() * (maxY - minY)
        retargetIn = 3 + random() * 5
      }
      const speed = Math.max(MIN_SPEED, Math.abs(vx))
      vx = (vx < 0 ? -1 : 1) * clamp(speed, MIN_SPEED, MAX_SPEED)
      vy = clamp((targetY - y) * 0.6, -26, 26)
    }

    x += vx * stepDt
    y += vy * stepDt

    // 壁で、向きを変える（食べに行くときは、壁にめり込まないよう、位置だけ収める）
    const half = size / 2
    if (x < half) {
      x = half
      if (!target) vx = Math.abs(vx)
    } else if (x > tank.width - half) {
      x = tank.width - half
      if (!target) vx = -Math.abs(vx)
    }
    y = clamp(y, half * 0.6 + 4, tank.height - tank.floor - half * 0.6)

    // 食べたものは、しばらくしてから、うんちとして出る（しっぽのほうから）
    if (digesting > 0) {
      poopIn -= stepDt
      if (poopIn <= 0) {
        dropped.push({ x: x - (vx < 0 ? -1 : 1) * size * 0.4, y: y + size * 0.15 })
        digesting -= 1
        poopIn = DIGEST_MIN + random() * (DIGEST_MAX - DIGEST_MIN)
      }
    }

    return { ...fish, x, y, vx, vy, wobble, spin, retargetIn, targetY, size, fed, digesting, poopIn }
  })

  // エサは、ゆっくり沈む。食べられたものと、底に着いたものは、なくなる
  const remaining = foods
    .filter((f) => !eatenFoodIds.has(f.id))
    .map((f) => ({ ...f, y: f.y + SINK_SPEED * stepDt }))
    .filter((f) => f.y < tank.height - tank.floor + 4)

  return { fishes: next, foods: remaining, eaten: eatenBy, dropped }
}

/** 出てきたうんちを、水槽に加える。上限を超えたら、古いものから消す。 */
export function addPoops(poops: readonly Poop[], dropped: readonly { x: number; y: number }[], tank: TankSize, nextId: number): Poop[] {
  const added = dropped.map((d, index) => ({
    id: nextId + index,
    x: clamp(d.x, 8, tank.width - 8),
    y: clamp(d.y, 8, tank.height - tank.floor),
    settled: false,
  }))
  return [...poops, ...added].slice(-MAX_POOP)
}

/**
 * dt 秒だけ、うんちを沈める。底に着いたら止まる（砂の上で、着く高さが少しずつ違うように、id から決める）。
 * 元の配列・オブジェクトは変えない。
 */
export function stepPoops(poops: readonly Poop[], tank: TankSize, dt: number): Poop[] {
  const stepDt = clamp(dt, 0, 0.1)
  return poops.map((poop) => {
    if (poop.settled) return poop
    const restY = tank.height - tank.floor + 6 + ((poop.id * 7) % 5) * 4
    const y = poop.y + POOP_SINK_SPEED * stepDt
    return y >= restY ? { ...poop, y: restY, settled: true } : { ...poop, y }
  })
}

/** 画面の (px, py) にあるうんちを探す（底に着いたものも、沈んでいるものも）。なければ null。 */
export function hitPoop(poops: readonly Poop[], px: number, py: number): Poop | null {
  let best: Poop | null = null
  let bestDistance = Infinity
  for (const poop of poops) {
    const d = Math.hypot(px - poop.x, py - poop.y)
    if (d <= POOP_HIT_RADIUS && d < bestDistance) {
      best = poop
      bestDistance = d
    }
  }
  return best
}

/** うんちをそうじする。 */
export function removePoop(poops: readonly Poop[], id: number): Poop[] {
  return poops.filter((poop) => poop.id !== id)
}

/** 画面の (px, py) にある魚を探す。重なっているときは、手前（配列の後ろ）を優先する。なければ null。 */
export function hitTest(fishes: readonly SwimmingFish[], px: number, py: number): SwimmingFish | null {
  for (let i = fishes.length - 1; i >= 0; i--) {
    const fish = fishes[i]
    const half = fish.size / 2 + HIT_PADDING
    if (Math.abs(px - fish.x) <= half && Math.abs(py - fish.y) <= half * 0.8) return fish
  }
  return null
}

/** 上下のゆらぎ（px）。大きい魚ほど、ゆっくり・小さく揺れる。 */
export function wobbleOffset(fish: SwimmingFish): number {
  return Math.sin(fish.wobble) * Math.max(1.5, fish.size * 0.04)
}

/** くるっと回る動きの、横の縮み方（1→-1→1）。回っていなければ 1。 */
export function spinScale(fish: SwimmingFish): number {
  if (fish.spin <= 0) return 1
  return Math.cos((1 - fish.spin / 0.6) * Math.PI * 2)
}
