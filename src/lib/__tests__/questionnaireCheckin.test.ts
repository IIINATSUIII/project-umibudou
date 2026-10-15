import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { QuestionnaireData, Reservation } from '@/types'

const memory = vi.hoisted(() => ({
  questionnaire: {} as QuestionnaireData,
  reservation: {} as Reservation,
  searchQuestionnaires: vi.fn(),
  getReservations: vi.fn(),
}))

vi.mock('@/lib/dataStore', () => ({
  store: {
    searchQuestionnaires: memory.searchQuestionnaires,
    getReservations: memory.getReservations,
  },
}))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'odp_session',
  verifySessionToken: async (token: string) => token === 'staff-session',
}))

import { GET } from '@/app/api/questionnaires/checkin/route'
import { RateLimitedError } from '../withRetry'

const qrToken = 'fresh-questionnaire-qr-token-1234567890'
const request = (token = qrToken) => new NextRequest(
  `http://localhost/api/questionnaires/checkin?token=${encodeURIComponent(token)}`,
  { headers: { cookie: 'odp_session=staff-session' } },
)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'))
  memory.questionnaire = {
    id: 'M-0001',
    reservationId: 'R-0001',
    qrToken,
    qrExpiresAt: '2026-10-07T00:00:00.000Z',
    qrUsed: false,
    lastName: '最新',
  } as QuestionnaireData
  memory.reservation = {
    id: 'R-0001',
    status: 'STS-03',
    diveDate: '2026-10-06',
  } as Reservation
  memory.searchQuestionnaires.mockReset().mockImplementation(async (token: string) =>
    token === qrToken ? [memory.questionnaire] : [],
  )
  memory.getReservations.mockReset().mockImplementation(async () => [memory.reservation])
})

afterEach(() => {
  vi.useRealTimers()
})

it('returns the latest questionnaire and reservation from the authenticated store lookup', async () => {
  const response = await GET(request())

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    questionnaire: { id: 'M-0001', lastName: '最新' },
    reservation: { id: 'R-0001', status: 'STS-03' },
  })
  expect(memory.searchQuestionnaires).toHaveBeenCalledWith(qrToken)
})

it('returns MSG-11 when the QR token has no matching questionnaire', async () => {
  const response = await GET(request('unknown-questionnaire-qr-token-1234567890'))

  expect(response.status).toBe(404)
  expect(await response.json()).toMatchObject({
    error: 'MSG-11：該当する問診情報が見つかりません。',
  })
})

it.each(['受付済み', '期限切れ'])('rejects a QR that is currently %s', async (state) => {
  memory.questionnaire = state === '受付済み'
    ? { ...memory.questionnaire, qrUsed: true }
    : { ...memory.questionnaire, qrExpiresAt: '2026-10-06T00:00:00.000Z' }

  const response = await GET(request())

  expect([409, 410]).toContain(response.status)
})

it('rejects a reservation that has since been cancelled', async () => {
  memory.reservation = { ...memory.reservation, status: 'STS-04' }

  const response = await GET(request())

  expect(response.status).toBe(409)
})

it('rejects QR codes for reservations outside the current Japan date', async () => {
  memory.reservation = { ...memory.reservation, diveDate: '2026-10-07' }

  const response = await GET(request())

  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('本日の予約') })
})

it('returns a retryable response when the latest lookup is rate limited', async () => {
  memory.searchQuestionnaires.mockRejectedValueOnce(new RateLimitedError('Sheets API rate limited'))

  const response = await GET(request())

  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('no-store')
})
