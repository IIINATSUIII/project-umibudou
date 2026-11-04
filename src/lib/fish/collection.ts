/**
 * おさかな図鑑のコレクション: 撮った魚の写真と、見つけた魚の記録。
 * このファイルは、ブラウザに依存しない処理（記録の検証・進み具合・並び順・縮小の大きさ）だけを置く。
 * 保存そのもの（端末の中の IndexedDB）は collectionStore.ts。
 *
 * 保存先は「その端末のブラウザの中だけ」。サーバーには送らない。
 * 写真は縮小して書き直して保存するので、撮影場所などの情報（EXIF）は残らない。
 */
import { SPECIES } from './classify'

/** 1枚の写真の記録 */
export interface CollectionEntry {
  id: string
  /** 追加した日時（ミリ秒） */
  createdAt: number
  /** 見つけた魚（SPECIES の id）。わからない・対応外の魚のときは null */
  speciesId: number | null
  /** 魚の名前を、判定の1位から選んだか('ai')、利用者が選び直したか('manual') */
  source: 'ai' | 'manual'
  /** 判定の1位の確率（目安の表示用） */
  topProbability: number
  /** 縮小した写真 */
  photo: Blob
  /**
   * 魚だけを切り抜いた画像（背景が透明）。水槽で泳がせる。
   * null = 切り抜けなかった（水槽では、写真を泡に包んで泳がせる）、undefined = まだ試していない（古い記録）
   */
  sprite?: Blob | null
  /** 水槽で食べたエサの数（魚が成長するもと）。無ければ 0 */
  fed?: number
}

/** 保存できる写真の上限（端末の容量を使い切らないため） */
export const MAX_ENTRIES = 150
/** 保存する写真の長い辺の最大（px）。縮小して、容量と個人情報（EXIF）を減らす */
export const MAX_PHOTO_SIDE = 960
/** 1枚あたりの目安の上限（バイト）。これを超える写真は保存しない */
export const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024

export type CollectionIssue =
  | 'LIMIT_REACHED'
  | 'INVALID_SPECIES'
  | 'EMPTY_PHOTO'
  | 'PHOTO_TOO_LARGE'

export class CollectionError extends Error {
  constructor(readonly issue: CollectionIssue, message: string) {
    super(message)
    this.name = 'CollectionError'
  }
}

export const COLLECTION_MESSAGES: Record<CollectionIssue, string> = {
  LIMIT_REACHED: `保存できる写真は${MAX_ENTRIES}枚までです。古い写真を削除してから追加してください。`,
  INVALID_SPECIES: '魚の種類を選び直してください。',
  EMPTY_PHOTO: '写真を読み取れませんでした。別の写真でお試しください。',
  PHOTO_TOO_LARGE: '写真が大きすぎて保存できませんでした。',
}

/** 追加してよい記録かを確かめる。だめなら CollectionError。 */
export function validateNewEntry(
  input: { speciesId: number | null; photo: Blob },
  currentCount: number
): void {
  if (currentCount >= MAX_ENTRIES) throw new CollectionError('LIMIT_REACHED', COLLECTION_MESSAGES.LIMIT_REACHED)
  if (input.speciesId !== null && !isSpeciesId(input.speciesId)) {
    throw new CollectionError('INVALID_SPECIES', COLLECTION_MESSAGES.INVALID_SPECIES)
  }
  if (input.photo.size === 0) throw new CollectionError('EMPTY_PHOTO', COLLECTION_MESSAGES.EMPTY_PHOTO)
  if (input.photo.size > MAX_PHOTO_BYTES) {
    throw new CollectionError('PHOTO_TOO_LARGE', COLLECTION_MESSAGES.PHOTO_TOO_LARGE)
  }
}

export function isSpeciesId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < SPECIES.length
}

/** 写真の長い辺が MAX_PHOTO_SIDE を超えるときだけ、縦横比を保って縮小した大きさを返す。 */
export function downscaledSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= MAX_PHOTO_SIDE) return { width, height }
  const scale = MAX_PHOTO_SIDE / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 新しい順に並べる（同じ時刻のときは id で安定させる）。元の配列は変えない。 */
export function sortNewestFirst(entries: readonly CollectionEntry[]): CollectionEntry[] {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

export interface SpeciesSlot {
  species: (typeof SPECIES)[number]
  /** 見つけていれば、その魚で一番新しい写真 */
  cover: CollectionEntry | null
  /** その魚の写真の枚数 */
  count: number
}

export interface CollectionProgress {
  /** 図鑑のマス目（SPECIES の順）。見つけていない魚は cover が null */
  slots: SpeciesSlot[]
  /** 見つけた魚の種類数 */
  found: number
  total: number
  /** 魚の種類がわからない（対応外など）写真の枚数 */
  unclassified: number
}

/** 記録から、図鑑のマス目と進み具合を作る。 */
export function buildProgress(entries: readonly CollectionEntry[]): CollectionProgress {
  const newest = sortNewestFirst(entries)
  const slots: SpeciesSlot[] = SPECIES.map((species) => ({ species, cover: null, count: 0 }))
  let unclassified = 0
  for (const entry of newest) {
    if (entry.speciesId === null || !isSpeciesId(entry.speciesId)) {
      unclassified++
      continue
    }
    const slot = slots[entry.speciesId]
    slot.count++
    slot.cover ??= entry // 新しい順に見ているので、最初に見つかったものが一番新しい
  }
  return { slots, found: slots.filter((s) => s.count > 0).length, total: SPECIES.length, unclassified }
}

/** 見つけた魚を何種類か（種類数だけ欲しいとき用）。 */
export function countFound(entries: readonly CollectionEntry[]): number {
  return new Set(entries.map((e) => e.speciesId).filter((id): id is number => isSpeciesId(id))).size
}
