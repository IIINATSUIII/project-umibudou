/**
 * 予約登録・更新のサーバーサイドバリデーション（詳細設計書 2-5-5）。
 * 通過しないデータはAPI側で書き込まない。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ReservationInputLike {
  guestName?: unknown
  guestPhone?: unknown
  guestEmail?: unknown
  diveDate?: unknown
  courseId?: unknown
  guestCount?: unknown
  channel?: unknown
}

function isBlank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

/** 予約新規登録の入力を検証し、エラーメッセージの配列を返す（空配列 = 検証OK） */
export function validateReservationInput(body: ReservationInputLike): string[] {
  const errors: string[] = []

  if (isBlank(body.guestName)) errors.push('代表者名は必須です')
  if (isBlank(body.guestPhone)) errors.push('電話番号は必須です')
  if (isBlank(body.courseId)) errors.push('コースは必須です')
  if (isBlank(body.channel)) errors.push('予約経路は必須です')

  if (isBlank(body.diveDate) || !DATE_RE.test(body.diveDate as string)) {
    errors.push('ダイブ日はYYYY-MM-DD形式で必須です')
  }

  const guestCount = Number(body.guestCount)
  if (!Number.isInteger(guestCount) || guestCount < 1) {
    errors.push('参加人数は1以上の整数で必須です')
  }

  if (typeof body.guestEmail === 'string' && body.guestEmail.trim() !== '' && !EMAIL_RE.test(body.guestEmail)) {
    errors.push('メールアドレスの形式が正しくありません')
  }

  return errors
}
