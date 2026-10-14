import { randomBytes } from 'crypto'
import type { QuestionnaireData, Reservation } from '@/types'
import { isQuestionnaireReservationAllowed } from './reservationStatus'

export const generateQuestionnaireToken = () =>
  randomBytes(32).toString('base64url')
/** 受付資格は入力URLとは独立に発行する。 */
export const generateQrToken = () => randomBytes(32).toString('base64url')

export function isReservationActive(r: Reservation): boolean {
  return isQuestionnaireReservationAllowed(r.status)
}

export function getQrError(q: QuestionnaireData, now = Date.now()): 'QR_USED' | 'QR_EXPIRED' | null {
  if (q.qrUsed) return 'QR_USED'
  if (!q.qrToken || !Number.isFinite(Date.parse(q.qrExpiresAt ?? '')) || Date.parse(q.qrExpiresAt!) <= now) return 'QR_EXPIRED'
  return null
}

export function getQuestionnaireScanError(
  questionnaire: QuestionnaireData | undefined,
  value: string,
  method: 'QR読取' | '手動照合',
  now = Date.now(),
): string | null {
  if (!questionnaire) return 'MSG-11：該当する問診情報が見つかりません。'
  if (questionnaire.qrUsed) return 'MSG-22：このQRコードは受付済みです。'
  if (
    (questionnaire.qrToken === value || method === 'QR読取') &&
    getQrError(questionnaire, now) === 'QR_EXPIRED'
  ) {
    return 'MSG-10：QRコードの有効期限が切れています。受付にお申し出ください。'
  }
  return null
}
export function getQuestionnaireExpiry(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(value.getTime()) ||
    value.toISOString().slice(0, 10) !== date
  )
    throw new Error('Invalid reservation date')
  return new Date(
    new Date(`${date}T00:00:00+09:00`).getTime() + 86400000
  ).toISOString()
}
export function isQuestionnaireUrlValid(
  r: Reservation | undefined,
  now = new Date()
): r is Reservation {
  if (
    !r?.questionnaireToken ||
    !r.questionnaireTokenExpiresAt ||
    !isQuestionnaireReservationAllowed(r.status)
  )
    return false
  const expiry = Date.parse(r.questionnaireTokenExpiresAt)
  try {
    return Number.isFinite(expiry) && expiry > now.getTime() &&
      Date.parse(getQuestionnaireExpiry(r.diveDate)) > now.getTime()
  } catch {
    return false
  }
}
export function findReservationByQuestionnaireToken(
  rows: Reservation[],
  token: unknown,
  now = new Date()
) {
  if (typeof token !== 'string' || !token || token.length > 200) return undefined
  const r = rows.find((v) => v.questionnaireToken === token)
  return isQuestionnaireUrlValid(r, now) ? r : undefined
}
