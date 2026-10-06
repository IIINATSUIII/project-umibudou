import { randomBytes } from 'crypto'
import type { Reservation, QuestionnaireData } from '@/types'

export function createToken(): string { return randomBytes(32).toString('base64url') }
export function getQuestionnaireExpiry(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid reservation date')
  return new Date(parsed.getTime() + 15 * 60 * 60 * 1000).toISOString()
}
export function findReservationByQuestionnaireToken(reservations: Reservation[], accessToken: unknown, now = Date.now()): Reservation | undefined {
  if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 200) return undefined
  return reservations.find((r) => r.questionnaireToken === accessToken && r.status !== 'cancelled' &&
    Number.isFinite(Date.parse(r.questionnaireExpiresAt ?? '')) && Date.parse(r.questionnaireExpiresAt!) > now &&
    Date.parse(getQuestionnaireExpiry(r.date)) > now)
}
export function isQrValid(q: QuestionnaireData, now = Date.now()): boolean {
  return !!q.qrToken && q.qrUsed !== true && Number.isFinite(Date.parse(q.qrExpiresAt ?? '')) && Date.parse(q.qrExpiresAt!) > now
}

// Serializes issuance/revocation/submission in this process. Multi-instance deployments need a DB transaction.
let queue: Promise<unknown> = Promise.resolve()
export function withQuestionnaireLock<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work)
  queue = result.catch(() => undefined)
  return result
}
