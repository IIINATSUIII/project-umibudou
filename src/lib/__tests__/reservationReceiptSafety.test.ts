import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  getReservations: vi.fn(),
  addReservation: vi.fn(),
  getReservationEmails: vi.fn(),
  addReservationEmail: vi.fn(),
  retryReservationEmail: vi.fn(),
}))

vi.mock('@/lib/dataStore', () => ({ store: mock }))
vi.mock('@/lib/storeLock', () => ({ withStoreWriteLock: (work: () => unknown) => work() }))
vi.mock('@/lib/reservationEmailWorker', () => ({ retryReservationEmail: mock.retryReservationEmail }))

import { createReservation, ReservationIdempotencyConflictError } from '@/lib/reservations'
import { POST as retryEmail } from '@/app/api/reservations/email-retry/route'

const input = {
  guestName: '山田 太郎', guestPhone: '09012345678', guestEmail: 'guest@example.com',
  diveDate: '2026-11-01', timeSlot: 'morning' as const, courseId: 'CRS-001',
  guestCount: 1, channel: 'hp' as const, staffNote: '送迎あり',
}

describe('reservation receipt recovery', () => {
  beforeEach(() => {
    for (const fn of Object.values(mock)) fn.mockReset()
    mock.getReservationEmails.mockResolvedValue([])
    mock.addReservation.mockResolvedValue(undefined)
    mock.addReservationEmail.mockResolvedValue(undefined)
  })

  it('rejects a retry key when the guest changes the saved request note', async () => {
    mock.getReservations.mockResolvedValue([{
      ...input, id: 'R-existing', publicRequestKey: 'request-1', staffNote: '送迎なし',
    }])

    await expect(createReservation(input, { sendReceipt: true, requestKey: 'request-1' }))
      .rejects.toBeInstanceOf(ReservationIdempotencyConflictError)
    expect(mock.addReservation).not.toHaveBeenCalled()
  })

  it('keeps a saved reservation successful if the optional Outbox is unavailable', async () => {
    mock.getReservations.mockResolvedValue([])
    mock.addReservationEmail.mockRejectedValue(new Error('Outbox sheet missing'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const reservation = await createReservation(input, { sendReceipt: true, requestKey: 'request-2' })

    expect(mock.addReservation).toHaveBeenCalledWith(expect.objectContaining({ id: reservation.id }))
    expect(reservation.publicRequestKey).toBe('request-2')
    expect(log).toHaveBeenCalledWith('[reservation-receipt] OUTBOX_WRITE_FAILED')
    log.mockRestore()
  })
})

describe('staff receipt retry endpoint', () => {
  it('rejects requests without a staff session before touching the Outbox', async () => {
    mock.retryReservationEmail.mockReset()
    const response = await retryEmail(new NextRequest('http://localhost/api/reservations/email-retry', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reservationId: 'R-123' }),
    }))
    expect(response.status).toBe(401)
    expect(mock.retryReservationEmail).not.toHaveBeenCalled()
  })
})
