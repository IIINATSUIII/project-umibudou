import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  getReservations: vi.fn(),
  patchReservation: vi.fn(),
}))

vi.mock('@/lib/dataStore', () => ({
  store: { getReservations: mock.getReservations },
  USES_SHEETS_STORE: false,
}))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'odp_session',
  verifySessionToken: async (token: string) => token === 'staff-session' ? { email: 'staff@example.com' } : null,
}))
vi.mock('@/lib/googleFormImport', () => ({ importGoogleFormBookings: vi.fn() }))
vi.mock('@/lib/reservations', () => ({
  createReservation: vi.fn(),
  generateReservationId: vi.fn(),
  patchReservation: mock.patchReservation,
  ReservationConflictError: class ReservationConflictError extends Error {},
}))

import { PATCH } from '@/app/api/reservations/route'

const current = (status: string) => ({
  id: 'R-1',
  updatedAt: '2026-10-20T00:00:00.000Z',
  status,
  diveDate: '2026-10-20',
  guestName: '山田 太郎',
  guestPhone: '090-1234-5678',
  guestCount: 1,
  timeSlot: 'morning',
  courseName: '体験ダイビング',
  channel: 'phone',
} as const)

const call = (body: unknown) => PATCH(new NextRequest('http://localhost/api/reservations', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', cookie: 'odp_session=staff-session' },
  body: JSON.stringify(body),
}))

describe('Issue #79 cancellation metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T01:02:03.000Z'))
    mock.getReservations.mockReset()
    mock.patchReservation.mockReset().mockResolvedValue('2026-10-20T01:02:04.000Z')
  })

  afterEach(() => vi.useRealTimers())

  it('records a before-confirmation cancellation with the optional reason', async () => {
    mock.getReservations.mockResolvedValue([current('STS-01')])

    const response = await call({
      id: 'R-1', status: 'STS-04', expectedUpdatedAt: '2026-10-20T00:00:00.000Z',
      cancellationReason: '日程変更',
    })

    expect(response.status).toBe(200)
    expect(mock.patchReservation).toHaveBeenCalledWith(
      'R-1',
      expect.objectContaining({
        status: 'STS-04',
        cancellationPhase: 'before',
        cancelledAt: '2026-10-20T01:02:03.000Z',
        cancellationReason: '日程変更',
      }),
      '2026-10-20T00:00:00.000Z',
    )
  })

  it('records an after-confirmation cancellation', async () => {
    mock.getReservations.mockResolvedValue([current('STS-03')])

    const response = await call({
      id: 'R-1', status: 'STS-04', expectedUpdatedAt: '2026-10-20T00:00:00.000Z',
    })

    expect(response.status).toBe(200)
    expect(mock.patchReservation).toHaveBeenCalledWith(
      'R-1',
      expect.objectContaining({
        status: 'STS-04',
        cancellationPhase: 'after',
        cancelledAt: '2026-10-20T01:02:03.000Z',
      }),
      '2026-10-20T00:00:00.000Z',
    )
  })

  it('does not guess a phase for a legacy cancelled reservation', async () => {
    mock.getReservations.mockResolvedValue([current('STS-04')])

    const response = await call({
      id: 'R-1', status: 'STS-04', expectedUpdatedAt: '2026-10-20T00:00:00.000Z',
    })

    expect(response.status).toBe(409)
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })
})
