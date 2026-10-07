import { createHmac, randomBytes } from 'crypto'

/** Generate an unguessable token for a newly created reservation. */
export function createReservationQuestionnaireToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Create the same legacy token on every instance using the reservation ID and app secret. */
export function deriveReservationQuestionnaireToken(reservationId: string): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required to derive reservation tokens')
  if (!reservationId) throw new Error('Reservation ID is required to derive a token')

  return createHmac('sha256', secret)
    .update(`okidive:questionnaire-url:v1:${reservationId}`)
    .digest('base64url')
}

/** Expire the guest questionnaire URL at midnight Japan time after the dive date. */
export function questionnaireTokenExpiryForDiveDate(diveDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diveDate)) {
    throw new Error('Invalid reservation date')
  }

  const utcDate = new Date(`${diveDate}T00:00:00.000Z`)
  if (Number.isNaN(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== diveDate) {
    throw new Error('Invalid reservation date')
  }

  const expiry = new Date(`${diveDate}T00:00:00+09:00`)
  expiry.setUTCDate(expiry.getUTCDate() + 1)
  return expiry.toISOString()
}
