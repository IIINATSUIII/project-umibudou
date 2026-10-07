import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Reservation, QuestionnaireData } from '@/types'

const memory = vi.hoisted(() => ({ reservations: [] as Reservation[], qs: [] as QuestionnaireData[], saves: vi.fn() }))
vi.mock('@/lib/dataStore', () => ({ store: {
  getReservations: async () => memory.reservations,
  getQuestionnaires: async () => memory.qs,
  updateReservation: async (id: string, delta: Partial<Reservation>) => Object.assign(memory.reservations.find(r => r.id === id)!, delta),
} }))
vi.mock('@/lib/storeLock', () => ({ withStoreWriteLock: async (work: () => Promise<unknown>) => work(), StoreBusyError: class extends Error {} }))
vi.mock('@/lib/questionnaireSubmission', () => ({ saveSubmission: memory.saves, SubmissionValidationError: class extends Error {} }))
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'odp_session', verifySessionToken: async () => null }))
import { GET, POST } from '@/app/api/public/questionnaires/route'
import { POST as issue, DELETE as revoke } from '@/app/api/reservations/questionnaire-url/route'
import { middleware } from '@/middleware'
import { findReservationByQuestionnaireToken, getQuestionnaireExpiry, getQrError } from '../questionnaireToken'

const token = 'input-token-with-at-least-128-bits'
const request = (body: unknown) => new NextRequest('http://localhost/api/public/questionnaires', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
const read = (value: string) => GET(new NextRequest('http://localhost/api/public/questionnaires?accessToken=' + encodeURIComponent(value)))
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T00:00:00Z'))
  vi.stubEnv('SESSION_SECRET', 'test-only-secret')
  memory.reservations = [{ id: 'R-1', diveDate: '2026-10-06', status: 'STS-03', questionnaireToken: token, questionnaireTokenExpiresAt: '2026-10-06T15:00:00Z' } as Reservation]
  memory.qs = [{ id: 'M-1', reservationId: 'R-1', qrToken: 'independent-reception-token', qrExpiresAt: '2026-10-06T15:00:00Z', qrUsed: false, submissionState: 'complete' } as QuestionnaireData]
  memory.saves.mockReset().mockImplementation(async () => memory.qs[0])
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it.each([{ reservationId: 'R-1' }, { token }, { accessToken: 'R-1' }, { accessToken: 'independent-reception-token' }, { accessToken: { token } }])('rejects non-input credentials %j before saving', async body => {
  expect((await POST(request(body))).status).toBe(404)
  expect(memory.saves).not.toHaveBeenCalled()
})
it('resolves the reservation from accessToken even when a different reservationId is supplied', async () => {
  const response = await POST(request({ accessToken: token, reservationId: 'attacker-selected' }))
  expect(response.status).toBe(200)
  expect(memory.saves.mock.calls[0][0].id).toBe('R-1')
  expect(await response.json()).toMatchObject({ questionnaireId: 'M-1', qrToken: 'independent-reception-token' })
})
it.each(['R-1', 'independent-reception-token', ''])('rejects GET using %s', async value => {
  expect((await read(value)).status).toBe(404)
})
it.each(['STS-04', 'STS-06', 'cancelled'])('rejects cancelled or unavailable reservation %s for all guest access', async status => {
  memory.reservations[0].status = status
  expect((await read(token)).status).toBe(404)
  expect((await POST(request({ accessToken: token }))).status).toBe(404)
  expect((await issue(request({ id: 'R-1' }))).status).toBe(404)
})
it.each(['', 'invalid', '2026-10-06T00:00:00Z'])('rejects absent, malformed or boundary expiry %s', async expiry => {
  memory.reservations[0].questionnaireTokenExpiresAt = expiry
  expect((await read(token)).status).toBe(404)
  expect((await POST(request({ accessToken: token }))).status).toBe(404)
})
it('checks the current dive date and fails closed for invalid dates', () => {
  for (const diveDate of ['2026-10-05', '2026-02-30', 'invalid']) {
    expect(findReservationByQuestionnaireToken([{ ...memory.reservations[0], diveDate }], token)).toBeUndefined()
  }
  expect(getQuestionnaireExpiry('2026-12-31')).toBe('2026-12-31T15:00:00.000Z')
})
it.each([{ qrUsed: true }, { qrExpiresAt: '2026-10-06T00:00:00Z' }, { qrExpiresAt: 'invalid' }, { qrToken: '' }])('does not return unusable QR from GET or POST %j', async delta => {
  Object.assign(memory.qs[0], delta)
  expect(getQrError(memory.qs[0])).not.toBeNull()
  expect((await read(token)).status).toBe(410)
  expect((await POST(request({ accessToken: token }))).status).toBe(410)
  expect(memory.saves).not.toHaveBeenCalled()
})
it('restores completed QR only through input token and does not expose pending submission', async () => {
  const response = await read(token)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ submitted: true, qrToken: 'independent-reception-token' })
  memory.qs[0].submissionState = 'pending'
  expect(await (await read(token)).json()).toEqual({ submitted: false })
})
it('reissue and revocation invalidate the old input credential without mutating consent or reception QR', async () => {
  const original = structuredClone(memory.qs)
  const result = await (await issue(request({ id: 'R-1', reissue: true }))).json()
  expect(result.questionnaireToken).not.toBe(token)
  expect(result.questionnaireToken).not.toBe(memory.qs[0].qrToken)
  expect(Buffer.from(result.questionnaireToken, 'base64url').length).toBe(32)
  expect((await read(token)).status).toBe(404)
  expect((await read(result.questionnaireToken)).status).toBe(200)
  expect((await revoke(request({ id: 'R-1' }))).status).toBe(200)
  expect((await read(result.questionnaireToken)).status).toBe(404)
  expect(memory.qs).toEqual(original)
})
it('protects staff scan and issuance endpoints while leaving token pages public', async () => {
  for (const path of ['/questionnaire/scan', '/questionnaire/scan/', '/api/reservations/questionnaire-url', '/api/questionnaires']) {
    expect((await middleware(new NextRequest('http://localhost' + path))).status).toBe(307)
  }
  expect((await middleware(new NextRequest('http://localhost/questionnaire/' + token))).status).toBe(200)
})
