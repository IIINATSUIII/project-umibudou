/**
 * おさかな図鑑: 写真から魚の種類を判定する処理のうち、ブラウザに依存しない部分。
 * モデル（EfficientNet-B0, 75種）は学習のときと同じ前処理を前提にしている。
 * 前処理を変えると精度が落ちるので、ここの数値（256 / 293 / 平均 / 標準偏差）は、モデルとセットで扱うこと。
 */
import speciesData from './speciesData.json'

export interface FishSpecies {
  id: number
  ja: string
  scientific: string
  /** iNaturalist（沖縄・研究グレード）での記録数。並び順（記録の多い順）の根拠 */
  observations: number
}

export const SPECIES: readonly FishSpecies[] = speciesData

/** モデルに渡す画像の一辺（px） */
export const INPUT_SIZE = 256
/** 短い辺をこの長さにそろえてから、中央を INPUT_SIZE で切り出す（256 × 256/224 ≒ 293） */
export const RESIZE_SHORT_SIDE = 293
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/** 1位の確率がこれ未満なら「自信がありません」と表示する */
export const CONFIDENT_THRESHOLD = 0.5
export const MODEL_URL = '/models/fish/fish-s75-v1.onnx'

/** 毒・とげ・かみつきの注意（名前による簡易の判定。正確な安全情報ではない） */
const CAUTIONS: ReadonlyArray<readonly [string, string]> = [
  ['ミノカサゴ', '毒のあるとげがあります。触らないでください。'],
  ['オニダルマオコゼ', '強い毒のとげがあります。触らないでください。'],
  ['ゴンズイ', '毒のあるとげがあります。触らないでください。'],
  ['アイゴ', '毒のあるとげがあります。触らないでください。'],
  ['ハリセンボン', 'とげがあります。触らないでください。'],
  ['モンガラ', 'かみつくことがあります。繁殖期は攻撃的です。'],
]

export function cautionFor(japaneseName: string): string | undefined {
  return CAUTIONS.find(([keyword]) => japaneseName.includes(keyword))?.[1]
}

export interface FishCandidate {
  species: FishSpecies
  probability: number
  caution?: string
}

export interface FishResult {
  candidates: FishCandidate[]
  /** 1位が CONFIDENT_THRESHOLD 以上か */
  confident: boolean
}

/** 確率の配列から、上位 n 件（既定3件）を取り出す。 */
export function rankCandidates(probabilities: ArrayLike<number>, topN = 3): FishResult {
  if (probabilities.length !== SPECIES.length) {
    throw new Error(`出力の数が合いません（${probabilities.length} / ${SPECIES.length}）`)
  }
  const order = Array.from({ length: probabilities.length }, (_, i) => i)
    .sort((a, b) => probabilities[b] - probabilities[a])
    .slice(0, topN)
  const candidates = order.map((i) => ({
    species: SPECIES[i],
    probability: probabilities[i],
    caution: cautionFor(SPECIES[i].ja),
  }))
  return { candidates, confident: candidates[0].probability >= CONFIDENT_THRESHOLD }
}

/** 写真の大きさから、「短い辺を RESIZE_SHORT_SIDE にそろえたあとの大きさ」を返す。 */
export function resizedSize(width: number, height: number): { width: number; height: number } {
  const scale = RESIZE_SHORT_SIDE / Math.min(width, height)
  return {
    width: Math.max(INPUT_SIZE, Math.round(width * scale)),
    height: Math.max(INPUT_SIZE, Math.round(height * scale)),
  }
}

/**
 * INPUT_SIZE × INPUT_SIZE の RGBA 画像（canvas の getImageData）を、モデルの入力（NCHW, float32）へ変える。
 * 0〜255 → 0〜1 にして、ImageNet の平均・標準偏差で正規化する。
 */
export function toModelInput(rgba: ArrayLike<number>): Float32Array {
  const pixels = INPUT_SIZE * INPUT_SIZE
  if (rgba.length !== pixels * 4) throw new Error('画像の大きさが合いません')
  const out = new Float32Array(3 * pixels)
  for (let i = 0; i < pixels; i++) {
    for (let channel = 0; channel < 3; channel++) {
      out[channel * pixels + i] = (rgba[i * 4 + channel] / 255 - MEAN[channel]) / STD[channel]
    }
  }
  return out
}
