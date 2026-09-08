import 'server-only'

import { randomBytes } from 'crypto'
import type { Reservation } from '@/types'

/** 128 bit の暗号論的乱数を URL-safe な文字列にする。 */
export function generateQuestionnaireToken(): string {
  return randomBytes(16).toString('base64url')
}

/** ダイブ日の翌日 00:00 JST を ISO 8601 (UTC) で返す。 */
export function getQuestionnaireExpiry(diveDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diveDate)) {
    throw new Error('Invalid reservation date')
  }

  const [year, month, day] = diveDate.split('-').map(Number)
  // JST の翌日 00:00 は UTC の前日 15:00。
  return new Date(Date.UTC(year, month - 1, day + 1, -9)).toISOString()
}

export function isQuestionnaireUrlValid(
  reservation: Reservation | undefined,
  now = new Date()
): reservation is Reservation & { questionnaireToken: string; questionnaireExpiresAt: string } {
  if (!reservation?.questionnaireToken || !reservation.questionnaireExpiresAt) return false
  if (reservation.status === 'cancelled') return false

  const expiresAt = Date.parse(reservation.questionnaireExpiresAt)
  return Number.isFinite(expiresAt) && expiresAt > now.getTime()
}

export function findReservationByQuestionnaireToken(
  reservations: Reservation[],
  token: string,
  now = new Date()
): Reservation | undefined {
  const reservation = reservations.find((item) => item.questionnaireToken === token)
  return isQuestionnaireUrlValid(reservation, now) ? reservation : undefined
}
