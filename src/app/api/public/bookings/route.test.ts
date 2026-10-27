import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const memory = vi.hoisted(() => ({
  createReservation: vi.fn(),
  ReservationIdempotencyConflictError: class extends Error {},
}))

vi.mock('@/lib/reservations', () => memory)

import { POST } from './route'

const validBody = {
  diveDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
  timeSlot: 'morning',
  courseId: 'CRS-001',
  guestName: '山田太郎',
  guestCount: 2,
  guestPhone: '090-1234-5678',
  guestEmail: 'guest@example.com',
}

function request(body: unknown, key?: string): NextRequest {
  return new NextRequest('http://localhost/api/public/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/public/bookings', () => {
  it('再送キーがない公開POSTを拒否する', async () => {
    const response = await POST(request(validBody))
    expect(response.status).toBe(400)
    expect(memory.createReservation).not.toHaveBeenCalled()
  })

  it('予約受付メール用の再送キーを予約作成サービスへ渡す', async () => {
    memory.createReservation.mockResolvedValueOnce({
      id: 'R-20261021-test',
      questionnaireToken: 'token',
      questionnaireTokenExpiresAt: '2026-10-22T00:00:00.000Z',
    })
    const response = await POST(request(validBody, 'browser-request-1'))
    expect(response.status).toBe(200)
    expect(memory.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ guestEmail: 'guest@example.com', channel: 'hp' }),
      { sendReceipt: true, requestKey: 'browser-request-1' },
    )
  })
})
