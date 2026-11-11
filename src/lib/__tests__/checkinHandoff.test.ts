import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { QuestionnaireData, Reservation } from '@/types'

const memory = vi.hoisted(() => ({ qs: [] as QuestionnaireData[], rs: [] as Reservation[], items: [] as { id: string; questionnaireId: string; createdAt: string; expiresAt: string }[], enqueue: vi.fn(), dismiss: vi.fn(), staffUser: vi.fn() }))
vi.mock('@/lib/dataStore', () => ({ store: { getQuestionnaires: async () => memory.qs, getReservations: async () => memory.rs } }))
vi.mock('@/lib/listReads', () => ({ getQuestionnairesForList: async () => memory.qs, getReservationsForList: async () => memory.rs }))
vi.mock('@/lib/checkinHandoffStore', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/checkinHandoffStore')>(), listCheckinHandoffs: async () => memory.items, enqueueCheckinHandoff: memory.enqueue, dismissCheckinHandoff: memory.dismiss }))
vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'odp_session', verifySessionToken: async (token: string) => token === 'db-staff' ? { email: 'staff@example.test', userId: 'U1', sessionVersion: 1 } : token === 'staff' ? { email: 'staff@example.test' } : null }))
vi.mock('@/lib/staffAccounts', () => ({ getStaffUserById: memory.staffUser }))
import { GET, POST, DELETE } from '@/app/api/checkin-handoff/route'

function request(method: string, body?: unknown, authenticated = true, origin = 'https://example.test') {
  return new NextRequest('https://example.test/api/checkin-handoff', { method, headers: { ...(authenticated ? { cookie: 'odp_session=staff' } : {}), origin, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T01:00:00Z'))
  vi.stubEnv('DATA_STORE', 'json')
  vi.stubEnv('SESSION_SECRET', 'test-only')
  memory.qs = [{ id: 'Q1', reservationId: 'R1', lastName: '山田', firstName: '花子', qrToken: 'valid-token-with-128-bits-or-more', qrExpiresAt: '2026-11-04T15:00:00Z', qrUsed: false } as QuestionnaireData]
  memory.rs = [{ id: 'R1', diveDate: '2026-11-04', status: 'confirmed' } as Reservation]
  memory.items = [{ id: '00000000-0000-4000-8000-000000000001', questionnaireId: 'Q1', createdAt: '2026-11-04T01:00:00Z', expiresAt: '2026-11-04T15:00:00Z' }]
  vi.clearAllMocks()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

it('requires staff authentication for all operations', async () => {
  expect((await GET(request('GET', undefined, false))).status).toBe(401)
  expect((await POST(request('POST', { qrToken: 'valid-token-with-128-bits-or-more' }, false))).status).toBe(401)
  expect((await DELETE(request('DELETE', { id: memory.items[0].id }, false))).status).toBe(401)
  expect(memory.enqueue).not.toHaveBeenCalled()
})
it('rejects cross-origin writes', async () => {
  expect((await POST(request('POST', { qrToken: 'valid-token-with-128-bits-or-more' }, true, 'https://other.test'))).status).toBe(403)
  expect((await DELETE(request('DELETE', { id: memory.items[0].id }, true, 'https://other.test'))).status).toBe(403)
})
it.each([{ status: 'disabled', sessionVersion: 1 }, { status: 'active', sessionVersion: 2 }])('rejects inactive or revoked database sessions %j', async user => {
  memory.staffUser.mockResolvedValue({ id: 'U1', email: 'staff@example.test', ...user })
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    const req = request(method, method === 'GET' ? undefined : { qrToken: 'valid-token-with-128-bits-or-more' })
    req.cookies.set('odp_session', 'db-staff')
    const handler = { GET, POST, DELETE }[method]
    expect((await handler(req)).status).toBe(401)
  }
  expect(memory.enqueue).not.toHaveBeenCalled()
  expect(memory.dismiss).not.toHaveBeenCalled()
})
it('enqueues without using the QR and returns only a name', async () => {
  const result = await POST(request('POST', { qrToken: 'valid-token-with-128-bits-or-more' }))
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({ name: '山田 花子' })
  expect(result.headers.get('cache-control')).toBe('no-store')
  expect(memory.enqueue).toHaveBeenCalledWith('Q1', '2026-11-04T15:00:00Z')
  expect(memory.qs[0].qrUsed).toBe(false)
})
it.each(['unknown', 'used', 'expired', 'cancelled', 'pending', 'completed', 'future'])('rejects %s QR without enqueueing', async reason => {
  if (reason === 'used') memory.qs[0].qrUsed = true
  if (reason === 'expired') memory.qs[0].qrExpiresAt = '2026-11-04T00:00:00Z'
  if (reason === 'cancelled') memory.rs[0].status = 'STS-04'
  if (reason === 'pending') memory.rs[0].status = 'STS-01'
  if (reason === 'completed') memory.rs[0].status = 'STS-05'
  if (reason === 'future') memory.rs[0].diveDate = '2026-11-05'
  const result = await POST(request('POST', { qrToken: reason === 'unknown' ? 'other' : 'valid-token-with-128-bits-or-more' }))
  expect(result.status).toBe(400)
  expect(memory.enqueue).not.toHaveBeenCalled()
})
it('lists minimal data and removes checked-in, cancelled and expired entries from the response', async () => {
  expect(await (await GET(request('GET'))).json()).toEqual({ items: [{ id: memory.items[0].id, questionnaireId: 'Q1', name: '山田 花子', createdAt: '2026-11-04T01:00:00Z' }], pollIntervalMs: 5000 })
  memory.qs[0].qrUsed = true
  expect(await (await GET(request('GET'))).json()).toEqual({ items: [], pollIntervalMs: 5000 })
  memory.qs[0].qrUsed = false
  memory.rs[0].status = 'cancelled'
  expect(await (await GET(request('GET'))).json()).toEqual({ items: [], pollIntervalMs: 5000 })
  memory.rs[0].status = 'confirmed'
  memory.qs[0].qrExpiresAt = '2026-11-04T00:00:00Z'
  expect(await (await GET(request('GET'))).json()).toEqual({ items: [], pollIntervalMs: 5000 })
})
it('dismisses without changing check-in state', async () => {
  expect((await DELETE(request('DELETE', { id: memory.items[0].id }))).status).toBe(200)
  expect(memory.dismiss).toHaveBeenCalledWith(memory.items[0].id)
  expect(memory.qs[0].qrUsed).toBe(false)
})
it.each([['json', 5000], ['postgres', 5000], ['sheets', 15000], ['', 15000]])('returns the polling interval for %s storage', async (backend, interval) => {
  vi.stubEnv('DATA_STORE', String(backend))
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'test@example.test')
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'test-key')
  vi.stubEnv('GOOGLE_SPREADSHEET_ID', 'test-sheet')
  expect((await (await GET(request('GET'))).json()).pollIntervalMs).toBe(interval)
})
