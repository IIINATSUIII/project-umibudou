/**
 * 一覧表示用の短期読取キャッシュ（Issue #68 / システムレビュー S13）。
 *
 * 複数スタッフ・複数画面が同時に一覧をポーリングしても、同一プロセス内では
 * TTL内のSheets読取を1回にまとめ、共有サービスアカウントの読取枠（既定60回/分）を守る。
 *
 * - 同時リクエストは実行中の読取を共有する（重複読込しない）
 * - 書込（invalidateReadCache）後は次の読取で必ず再取得する。書込前に始まった読取の結果は保存しない
 * - API制限（RateLimitedError）時は、取得済みの値が古すぎなければそれを返して画面更新を止めない
 *
 * 競合チェック・採番などの書込経路では使わないこと（常に最新値を読む必要があるため）。
 */

import { RateLimitedError } from './withRetry'

/** 一覧の鮮度：この時間内の再読取はキャッシュを返す */
export const READ_CACHE_TTL_MS = 15_000
/** API制限時に古い値で代替してよい上限 */
export const READ_CACHE_STALE_ON_RATE_LIMIT_MS = 5 * 60_000

type Entry = {
  value?: unknown
  fetchedAt: number
  /** 書込で無効化されたらfalse。値はAPI制限時の代替用に残す */
  fresh: boolean
  inFlight?: Promise<unknown>
  inFlightGeneration?: number
}

const entries = new Map<string, Entry>()
let generation = 0

export async function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const entry = entries.get(key) ?? { fetchedAt: 0, fresh: false }
  entries.set(key, entry)
  if (entry.fresh && now() - entry.fetchedAt < READ_CACHE_TTL_MS) {
    return entry.value as T
  }
  if (entry.inFlight && entry.inFlightGeneration === generation) {
    return entry.inFlight as Promise<T>
  }

  const startedGeneration = generation
  // load は必ず非同期に開始する（同期例外でも finally が request 代入後に走るように）
  const request: Promise<T> = Promise.resolve()
    .then(load)
    .then(
      (value) => {
        // 読取中に書込があった場合、この値は書込前の可能性があるため保存しない
        if (startedGeneration === generation) {
          entry.value = value
          entry.fetchedAt = now()
          entry.fresh = true
        }
        return value
      },
      (err: unknown) => {
        if (
          err instanceof RateLimitedError &&
          entry.value !== undefined &&
          now() - entry.fetchedAt < READ_CACHE_STALE_ON_RATE_LIMIT_MS
        ) {
          console.warn(`[readCache] ${key}: API制限のため取得済みの一覧を返します`)
          return entry.value as T
        }
        throw err
      },
    )
    .finally(() => {
      if (entry.inFlight === request) {
        entry.inFlight = undefined
        entry.inFlightGeneration = undefined
      }
    })
  entry.inFlight = request
  entry.inFlightGeneration = startedGeneration
  return request
}

/** 書込後に呼ぶ。以降の読取は必ず再取得する（API制限時の代替値としては保持する）。 */
export function invalidateReadCache(): void {
  generation += 1
  entries.forEach((entry) => { entry.fresh = false })
}

/** テスト用 */
export function resetReadCacheForTests(): void {
  entries.clear()
  generation = 0
}
