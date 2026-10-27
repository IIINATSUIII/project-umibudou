import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { QuestionnaireData, Reservation } from '@/types'

const memory = vi.hoisted(() => ({
  reservations: [] as Reservation[],
  questionnaires: [] as QuestionnaireData[],
  getReservations: vi.fn(),
  getQuestionnaires: vi.fn(),
}))

vi.mock('@/lib/dataStore', () => ({
  store: {
    getReservations: memory.getReservations,
    getQuestionnaires: memory.getQuestionnaires,
  },
}))

import { POST } from '@/app/api/public/checkin-qr/route'

const questionnaireToken = 'questionnaire-input-token-1234567890'

function request(reservationId: string | undefined = 'R-1', reservationToken = questionnaireToken) {
  return new NextRequest('http://localhost/api/public/checkin-qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(reservationId === undefined ? {} : { reservationId }), reservationToken }),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'))
  memory.reservations = [{
    id: 'R-1',
    diveDate: '2026-10-06',
    status: 'STS-03',
    guestCount: 1,
    courseName: '体験ダイビング',
    timeSlot: 'morning',
    questionnaireToken,
    questionnaireTokenExpiresAt: '2026-10-06T15:00:00.000Z',
  } as Reservation]
  memory.questionnaires = [{
    id: 'Q-1',
    reservationId: 'R-1',
    lastName: '山田',
    firstName: '太郎',
    email: 'private@example.com',
    heartDisease: true,
    qrToken: 'independent-reception-qr-token',
    qrExpiresAt: '2026-10-06T15:00:00.000Z',
    qrUsed: false,
  } as QuestionnaireData]
  memory.getReservations.mockReset().mockResolvedValue(memory.reservations)
  memory.getQuestionnaires.mockReset().mockResolvedValue(memory.questionnaires)
})

afterEach(() => {
  vi.useRealTimers()
})

it('returns the canonical access-token path and keeps questionnaire details private', async () => {
  const response = await POST(request())
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.questionnaireUrl).toBe(`/questionnaire/${encodeURIComponent(questionnaireToken)}`)
  expect(body.questionnaireUrl).not.toContain('token=')
  expect(body.participants).toEqual([{
    name: '山田 太郎',
    token: 'independent-reception-qr-token',
    expiresAt: '2026-10-06T15:00:00.000Z',
    used: false,
  }])
  expect(JSON.stringify(body)).not.toContain('private@example.com')
  expect(JSON.stringify(body)).not.toContain('heartDisease')
})

it('rejects a reservation ID without its confirmation token', async () => {
  const response = await POST(request('R-1', ''))

  expect(response.status).toBe(400)
})

it('keeps cancelled reservations and expired confirmation tokens unavailable', async () => {
  memory.reservations[0].status = 'STS-04'
  expect((await POST(request())).status).toBe(404)

  memory.reservations[0].status = 'STS-03'
  memory.reservations[0].questionnaireTokenExpiresAt = '2026-10-05T15:00:00.000Z'
  expect((await POST(request())).status).toBe(410)
})

it('finds the reservation by the confirmation token alone when no reservation ID is sent', async () => {
  const response = await POST(request(undefined))
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.reservation.courseName).toBe('体験ダイビング')
  expect(body.participants).toHaveLength(1)
})

it('does not reveal a reservation for an unknown or truncated token when no reservation ID is sent', async () => {
  expect((await POST(request(undefined, 'x'.repeat(36)))).status).toBe(404)
  expect((await POST(request(undefined, questionnaireToken.slice(0, 30)))).status).toBe(404)
  expect((await POST(request(undefined, 'short'))).status).toBe(400)
})

it('keeps unconfirmed, cancelled and expired reservations unavailable when looked up by token alone', async () => {
  memory.reservations[0].status = 'STS-01'
  expect((await POST(request(undefined))).status).toBe(404)

  memory.reservations[0].status = 'STS-04'
  expect((await POST(request(undefined))).status).toBe(404)

  memory.reservations[0].status = 'STS-03'
  memory.reservations[0].questionnaireTokenExpiresAt = '2026-10-05T15:00:00.000Z'
  expect((await POST(request(undefined))).status).toBe(410)
})

it('still requires the reservation ID to match when one is sent (a wrong ID does not fall back to the token)', async () => {
  expect((await POST(request('R-OTHER'))).status).toBe(404)
})
