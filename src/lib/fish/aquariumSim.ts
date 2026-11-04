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
  /** 表示の大きさ（px。長い辺） */
  size: number
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

export type Random = () => number

/** 通常の泳ぐ速さ（px/秒）の範囲。大きい魚ほど、ゆっくり */
const MIN_SPEED = 28
const MAX_SPEED = 78
/** エサに向かうときの速さ（px/秒） */
const FOOD_SPEED = 120
const SINK_SPEED = 38
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

export function createFish(id: string, tank: TankSize, random: Random): SwimmingFish {
  const size = fishSizeFor(tank, random)
  const speed = MAX_SPEED - (size / Math.max(1, Math.min(tank.width, tank.height))) * (MAX_SPEED - MIN_SPEED) * 2.2
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
): { fishes: SwimmingFish[]; foods: Food[]; eaten: string[] } {
  const eatenFoodIds = new Set<number>()
  const eatenBy: string[] = []
  const stepDt = clamp(dt, 0, 0.1) // 長い間の停止（タブが裏に回ったときなど）で、魚が飛ばないように

  const next = fishes.map((fish) => {
    const target = nearestFood(fish, foods.filter((f) => !eatenFoodIds.has(f.id)))
    let { x, y, vx, vy, wobble, spin, retargetIn, targetY } = fish
    wobble += stepDt * 2.4
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
    const half = fish.size / 2
    if (x < half) {
      x = half
      if (!target) vx = Math.abs(vx)
    } else if (x > tank.width - half) {
      x = tank.width - half
      if (!target) vx = -Math.abs(vx)
    }
    y = clamp(y, half * 0.6 + 4, tank.height - tank.floor - half * 0.6)

    return { ...fish, x, y, vx, vy, wobble, spin, retargetIn, targetY }
  })

  // エサは、ゆっくり沈む。食べられたものと、底に着いたものは、なくなる
  const remaining = foods
    .filter((f) => !eatenFoodIds.has(f.id))
    .map((f) => ({ ...f, y: f.y + SINK_SPEED * stepDt }))
    .filter((f) => f.y < tank.height - tank.floor + 4)

  return { fishes: next, foods: remaining, eaten: eatenBy }
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
