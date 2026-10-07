import { randomBytes } from 'crypto'
import type { Reservation } from '@/types'

export const generateQuestionnaireToken = () =>
  randomBytes(32).toString('base64url')
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
    ['STS-04', 'cancelled', 'STS-06'].includes(r.status)
  )
    return false
  const expiry = Date.parse(r.questionnaireTokenExpiresAt)
  return Number.isFinite(expiry) && expiry > now.getTime()
}
export function findReservationByQuestionnaireToken(
  rows: Reservation[],
  token: string,
  now = new Date()
) {
  if (!token || token.length > 200) return undefined
  const r = rows.find((v) => v.questionnaireToken === token)
  return isQuestionnaireUrlValid(r, now) ? r : undefined
}
