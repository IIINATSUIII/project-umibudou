/** 予約完了画面などから /line-menu/checkin を開くためのリンク（予約番号と確認コードをURLに含める）。 */
export function buildCheckinPath(reservationId: string, reservationToken: string): string {
  const params = new URLSearchParams({ reservationId, token: reservationToken })
  return `/line-menu/checkin?${params.toString()}`
}

export type CheckinCredential = { reservationId?: string; reservationToken: string }

/** URLから予約番号と確認コードを取り出す。どちらかが欠けていれば null（保存済みの予約か手入力にする）。 */
export function readCheckinParams(
  params: Pick<URLSearchParams, 'get'>
): { reservationId: string; reservationToken: string } | null {
  const reservationId = (params.get('reservationId') ?? '').trim()
  const reservationToken = (params.get('token') ?? '').trim()
  if (!reservationId || !reservationToken) return null
  return { reservationId, reservationToken }
}

/**
 * 入力欄に貼り付けられた文字列から確認コードを取り出す。
 * 受付QRの確認リンク・問診票のURL・確認コードそのもの、のどれでも受け付ける。
 */
export function parseCheckinInput(text: string): CheckinCredential | null {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null

  if (/^https?:\/\//i.test(value) || value.startsWith('/')) {
    let url: URL
    try {
      url = new URL(value, 'https://placeholder.invalid')
    } catch {
      return null
    }
    const fromParams = readCheckinParams(url.searchParams)
    if (fromParams) return fromParams
    const token = url.searchParams.get('token')?.trim()
    if (token) return { reservationToken: token }
    const match = url.pathname.match(/^\/questionnaire\/([^/]+)\/?$/)
    if (match) {
      try {
        const decoded = decodeURIComponent(match[1])
        return decoded && decoded !== 'scan' ? { reservationToken: decoded } : null
      } catch {
        return null
      }
    }
    return null
  }
  return { reservationToken: value }
}

/** 予約した端末に残しておく、受付QR確認用の情報（その端末のブラウザの中だけに保存する）。 */
export type SavedCheckin = {
  reservationId: string
  reservationToken: string
  diveDate: string
  savedAt: number
}

export const CHECKIN_STORAGE_KEY = 'odp.checkin.v1'
const MAX_SAVED = 5

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function isSavedCheckin(value: unknown): value is SavedCheckin {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.reservationId === 'string' && v.reservationId !== '' &&
    typeof v.reservationToken === 'string' && v.reservationToken !== '' &&
    typeof v.diveDate === 'string' &&
    typeof v.savedAt === 'number'
  )
}

/** 保存済みの予約を、新しい順で返す。壊れたデータ・保存できない環境では空配列。 */
export function loadSavedCheckins(storage: StorageLike | undefined): SavedCheckin[] {
  try {
    const raw = storage?.getItem(CHECKIN_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedCheckin).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_SAVED)
  } catch {
    return []
  }
}

/** 予約を1件保存する。同じ確認コードは上書きし、新しいものから最大5件まで残す。 */
export function saveCheckin(
  storage: StorageLike | undefined,
  entry: Omit<SavedCheckin, 'savedAt'>,
  now = Date.now()
): void {
  try {
    if (!storage) return
    const others = loadSavedCheckins(storage).filter((e) => e.reservationToken !== entry.reservationToken)
    const next = [{ ...entry, savedAt: now }, ...others].slice(0, MAX_SAVED)
    storage.setItem(CHECKIN_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 保存できない環境（プライベートモード等）では、保存せずに続ける
  }
}

export function clearSavedCheckins(storage: StorageLike | undefined): void {
  try {
    storage?.removeItem(CHECKIN_STORAGE_KEY)
  } catch {
    // 何もしない
  }
}
