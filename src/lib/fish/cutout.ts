/**
 * 魚の切り抜き（水槽で泳がせるための、背景のない魚の画像）の、ブラウザに依存しない処理。
 *
 * 切り抜きには、小さな「目立つものを見つける」AI（U²-Netp, Apache-2.0）を使う。
 * 出力は、0〜1 の「ここが目立つ」マップ。ここでは、そのマップの扱い（透明度への変換・成否の判定・切り出す範囲）だけを置く。
 * 水中の写真は背景が複雑で、魚が小さい写真では、うまく切り抜けない。その場合は、写真を丸い泡に包んで泳がせる。
 */

/** AI に渡す画像の一辺（px） */
export const CUTOUT_INPUT_SIZE = 320
export const CUTOUT_MODEL_URL = '/models/fish/u2netp-v1.onnx'
/** 切り抜き画像の長い辺の最大（px）。水槽の中では小さく表示するので、小さくてよい */
export const SPRITE_MAX_SIDE = 256

/** 「魚がいる」とみなす確率の境目 */
export const MASK_THRESHOLD = 0.5
/** 魚が写真全体に占める割合が、この範囲なら「切り抜けた」とみなす（小さすぎる=見つけられなかった、大きすぎる=背景ごと） */
export const MIN_COVERAGE = 0.015
export const MAX_COVERAGE = 0.85

/** 出力のマップを、最小0・最大1にそろえる。すべて同じ値なら、すべて0にする。 */
export function normalizeMap(values: ArrayLike<number>): Float32Array {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i]
    if (values[i] > max) max = values[i]
  }
  const out = new Float32Array(values.length)
  const range = max - min
  if (!(range > 1e-8)) return out
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - min) / range
  return out
}

/** マップ（0〜1）を、0〜255 の透明度に変える。境目をなめらかにして、輪郭がギザギザにならないようにする。 */
export function toAlpha(mapValue: number): number {
  const t = (mapValue - 0.35) / 0.3
  return Math.round(Math.min(1, Math.max(0, t)) * 255)
}

/** 写真全体のうち、魚とみなす場所の割合（0〜1）。 */
export function coverageOf(map: ArrayLike<number>): number {
  if (map.length === 0) return 0
  let count = 0
  for (let i = 0; i < map.length; i++) if (map[i] > MASK_THRESHOLD) count++
  return count / map.length
}

/** 切り抜きがうまくいったか（魚が、小さすぎず・大きすぎない）。 */
export function isUsableCutout(coverage: number): boolean {
  return coverage >= MIN_COVERAGE && coverage <= MAX_COVERAGE
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 魚の部分を囲む四角を求める（余白つき）。魚が1か所も無ければ null。
 * map は width × height の行ごとの並び。
 */
export function boundingBox(map: ArrayLike<number>, width: number, height: number, padding = 0.06): Box | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (map[y * width + x] > MASK_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const padX = Math.round((maxX - minX + 1) * padding)
  const padY = Math.round((maxY - minY + 1) * padding)
  const x = Math.max(0, minX - padX)
  const y = Math.max(0, minY - padY)
  return {
    x,
    y,
    width: Math.min(width, maxX + padX + 1) - x,
    height: Math.min(height, maxY + padY + 1) - y,
  }
}

/** 切り抜いた魚の大きさを、長い辺が SPRITE_MAX_SIDE になるように縮小する（拡大はしない）。 */
export function spriteSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= SPRITE_MAX_SIDE) return { width, height }
  const scale = SPRITE_MAX_SIDE / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 2回目の切り抜き（中央を拡大して、もう一度）に使う範囲。写真の中央の60%。 */
export function centerCropBox(width: number, height: number, ratio = 0.6): Box {
  const w = Math.max(1, Math.round(width * ratio))
  const h = Math.max(1, Math.round(height * ratio))
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h }
}

/**
 * 切り抜いた画像を、魚の判定AIにかけ直した結果から、「ちゃんと魚を切り抜けていそうか」を決める。
 * 目安であり、確実ではない（正しい切り抜きでも「疑わしい」と出ることがある）ので、最終的には利用者に見てもらう。
 *
 * - 元の写真で判定した魚（expectedId）が、切り抜きでも1位で、確率が元の30%以上なら 'ok'
 * - 魚の種類がわからない（expectedId が null）ときは、確かめようがないので 'unknown'
 * - それ以外は 'doubtful'
 */
export type CutoutVerdict = 'ok' | 'doubtful' | 'unknown'
export const VERDICT_MIN_RATIO = 0.3

export function judgeCutout(
  expectedId: number | null,
  originalProbability: number,
  cutoutTopId: number,
  cutoutTopProbability: number
): CutoutVerdict {
  if (expectedId === null) return 'unknown'
  if (cutoutTopId !== expectedId) return 'doubtful'
  return cutoutTopProbability >= originalProbability * VERDICT_MIN_RATIO ? 'ok' : 'doubtful'
}
