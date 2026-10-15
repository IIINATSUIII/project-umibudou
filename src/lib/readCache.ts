/**
 * 一覧表示用の短期読取キャッシュ（Issue #68 / システムレビュー S13）。
 *
 * 複数スタッフ・複数画面が同時に一覧をポーリングしても、同一プロセス内では
 * TTL内の同一プロセス読取を1回にまとめる。実際のSheets読取はFirestore共有枠でも制限する。
 *
 * - 同時リクエストは実行中の読取を共有する（重複読込しない）
 * - 書込（invalidateReadCache）後は次の読取で必ず再取得する。書込前に始まった読取の結果は保存しない
 * - API制限（RateLimitedError）時は、取得済みの値が古すぎず、かつ書込で無効化されていなければそれを返して画面更新を止めない
 *   （自分の書込より前の値で画面を巻き戻さない）
 * - TTLはプロセス単位。複数インスタンスでは他インスタンスの書込が最大TTLだけ遅れて見えるため短くしている
 *
 * 競合チェック・採番などの書込経路では使わないこと（常に最新値を読む必要があるため）。
 */

import { RateLimitedError } from './withRetry'
import { withStoreWriteLock } from './storeLock'

/** 一覧の鮮度：この時間内の再読取はキャッシュを返す */
export const READ_CACHE_TTL_MS = 5_000
/** API制限時に古い値で代替してよい上限 */
export const READ_CACHE_STALE_ON_RATE_LIMIT_MS = 5 * 60_000

/** Reserve a slot against the service account's shared Sheets read quota. */
export const SHARED_SHEETS_READS_PER_MINUTE = 50
const SHARED_READ_WINDOW_MS = 60_000

export async function reserveSharedSheetsReadSlot(now: () => number = Date.now): Promise<void> {
  const configuredStore = process.env.DATA_STORE
  const sheetsConfigured = configuredStore === 'sheets' || (!configuredStore && Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SPREADSHEET_ID,
  ))
  if (!sheetsConfigured) return

  const project = process.env.GOOGLE_DATASTORE_LOCK_PROJECT_ID
  if (!project) {
    throw new Error('GOOGLE_DATASTORE_LOCK_PROJECT_ID is required for shared Sheets read quota')
  }

  await withStoreWriteLock(async () => {
    const { google } = await import('googleapis')
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/datastore'],
    })
    const firestore = google.firestore({ version: 'v1', auth })
    const parent = 'projects/' + project + '/databases/(default)/documents'
    const name = parent + '/odpLocks/sheets-read-budget'
    const nowMs = now()
    let documentExists = false
    let timestamps: number[] = []

    try {
      const response = await firestore.projects.databases.documents.get({ name })
      documentExists = true
      const values = response.data.fields?.timestamps?.arrayValue?.values ?? []
      timestamps = values.flatMap((value) => {
        const valueText = value.timestampValue
        if (!valueText) return []
        const timestamp = Date.parse(valueText)
        return Number.isFinite(timestamp) ? [timestamp] : []
      })
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err
    }

    const recent = timestamps.filter((timestamp) =>
      timestamp > nowMs - SHARED_READ_WINDOW_MS && timestamp <= nowMs + SHARED_READ_WINDOW_MS,
    )
    if (recent.length >= SHARED_SHEETS_READS_PER_MINUTE) {
      // Use RateLimitedError so callers can serve a recent cached value when safe.
      throw new RateLimitedError('Shared Sheets read capacity reached')
    }

    recent.push(nowMs)
    const requestBody = {
      fields: {
        timestamps: {
          arrayValue: {
            values: recent.map((timestamp) => ({
              timestampValue: new Date(timestamp).toISOString(),
            })),
          },
        },
      },
    }
    if (documentExists) {
      await firestore.projects.databases.documents.patch({ name, 'updateMask.fieldPaths': ['timestamps'], requestBody })
    } else {
      await firestore.projects.databases.documents.createDocument({
        parent,
        collectionId: 'odpLocks',
        documentId: 'sheets-read-budget',
        requestBody,
      })
    }
  })
}

type Entry = {
  value?: unknown
  fetchedAt: number
  /** 書込で無効化されたらfalse。無効化された値はAPI制限時の代替にも使わない */
  fresh: boolean
  inFlight?: Promise<unknown>
  inFlightGeneration?: number
}

const entries = new Map<string, Entry>()
let generation = 0

export type CachedReadOptions = {
  /** trueならキャッシュを使わず必ず読み直す（競合後の再読込など）。結果はキャッシュに保存する */
  force?: boolean
  now?: () => number
}

export async function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  { force = false, now = Date.now }: CachedReadOptions = {},
): Promise<T> {
  const entry = entries.get(key) ?? { fetchedAt: 0, fresh: false }
  entries.set(key, entry)
  if (!force && entry.fresh && now() - entry.fetchedAt < READ_CACHE_TTL_MS) {
    return entry.value as T
  }
  if (!force && entry.inFlight && entry.inFlightGeneration === generation) {
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
          entry.fresh &&
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

/** 書込後に呼ぶ。以降の読取は必ず再取得する。 */
export function invalidateReadCache(): void {
  generation += 1
  entries.forEach((entry) => { entry.fresh = false })
}

/** テスト用 */
export function resetReadCacheForTests(): void {
  entries.clear()
  generation = 0
}
