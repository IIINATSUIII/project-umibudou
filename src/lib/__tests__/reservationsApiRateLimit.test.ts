import { it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { RateLimitedError } from '../withRetry'
import { MSG } from '../messages'

const mock = vi.hoisted(() => ({
  getReservations: vi.fn(),
  createReservation: vi.fn(),
  patchReservation: vi.fn(),
}))
vi.mock('@/lib/dataStore', () => ({ store: { getReservations: mock.getReservations } }))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'odp_session',
  verifySessionToken: async (token: string) => token === 'staff-session' ? { email: 'staff@example.com' } : null,
}))
vi.mock('@/lib/googleFormImport', () => ({ importGoogleFormBookings: async () => ({ errors: [] }) }))
vi.mock('@/lib/reservations', () => ({
  createReservation: mock.createReservation,
  patchReservation: mock.patchReservation,
  ReservationConflictError: class ReservationConflictError extends Error {},
}))

import { GET, POST, PATCH } from '../../app/api/reservations/route'
import { POST as publicBooking } from '../../app/api/public/bookings/route'

const url = 'http://localhost/api/reservations'
const json = (method: string, body: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', cookie: 'odp_session=staff-session' },
    body: JSON.stringify(body),
  })
const validBooking = {
  guestName: '山田 太郎',
  guestPhone: '090-1234-5678',
  guestEmail: 'taro@example.com',
  diveDate: '2099-01-01',
  timeSlot: 'morning',
  courseId: 'CRS-001',
  guestCount: 2,
  channel: 'phone',
}
const limited = () => new RateLimitedError('Sheets API rate limited')

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mock.getReservations.mockReset()
  mock.createReservation.mockReset()
  mock.patchReservation.mockReset()
})

it('MSG-17の文言は設計書どおり', () => {
  expect(MSG.RATE_LIMITED).toBe('通信が集中しています。しばらく経ってから再度お試しください。')
})

it('GET: API制限が続く場合は503とMSG-17を返す(500にしない)', async () => {
  mock.getReservations.mockRejectedValue(limited())

  const res = await GET(new NextRequest(url, { headers: { cookie: 'odp_session=staff-session' } }))

  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: MSG.RATE_LIMITED })
  expect(mock.getReservations).toHaveBeenCalledTimes(1)
})

it('GET: API制限以外の失敗は従来どおり500', async () => {
  mock.getReservations.mockRejectedValue(new Error('boom'))

  expect((await GET(new NextRequest(url, { headers: { cookie: 'odp_session=staff-session' } }))).status).toBe(500)
})

it('POST(スタッフ登録): API制限が続く場合は503とMSG-17を返す', async () => {
  mock.createReservation.mockRejectedValue(limited())

  const res = await POST(json('POST', validBooking))

  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: MSG.RATE_LIMITED })
})

it('PATCH: API制限は503とMSG-17、ロック待ちは従来の文言で503', async () => {
  mock.patchReservation.mockRejectedValueOnce(limited())
  const body = { id: 'R-1', status: 'STS-03', expectedUpdatedAt: 'x' }

  const rate = await PATCH(json('PATCH', body))
  expect(rate.status).toBe(503)
  expect(await rate.json()).toEqual({ error: MSG.RATE_LIMITED })

  const { StoreBusyError } = await import('../storeLock')
  mock.patchReservation.mockRejectedValueOnce(new StoreBusyError('busy'))
  const busy = await PATCH(json('PATCH', body))
  expect(busy.status).toBe(503)
  expect((await busy.json()).error).toBe('保存処理中です。時間をおいて再度お試しください。')
})

it('公開予約(POST /api/public/bookings): API制限が続く場合は503とMSG-17を返す', async () => {
  mock.createReservation.mockRejectedValue(limited())

  const res = await publicBooking(
    new NextRequest('http://localhost/api/public/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBooking),
    })
  )

  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: MSG.RATE_LIMITED })
})
