import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const worker = vi.hoisted(() => vi.fn())
vi.mock('@/lib/dataStore', () => ({ USE_POSTGRES: true }))
vi.mock('@/lib/sheetsOutboxWorker', () => ({ runSheetsOutboxWorker: worker }))
import { GET, POST } from '@/app/api/cron/sheets-outbox/route'

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-only-test-secret')
  worker.mockReset().mockResolvedValue({ delivered: 0 })
})
afterEach(() => vi.unstubAllEnvs())

it.each([GET, POST])('accepts the cron bearer without a staff cookie', async (handle) => {
  const response = await handle(new NextRequest('http://localhost/api/cron/sheets-outbox', {
    headers: { authorization: 'Bearer cron-only-test-secret' },
  }))
  expect(response.status).toBe(200)
  expect(worker).toHaveBeenCalledTimes(1)
})

const invalidHeaders: Record<string, string>[] = [
  {}, { cookie: 'odp_session=staff-session' }, { authorization: 'Bearer wrong-secret' },
]
it.each(invalidHeaders)(
  'rejects missing or invalid service credentials: %j', async (headers) => {
    const response = await POST(new NextRequest('http://localhost/api/cron/sheets-outbox', { headers }))
    expect(response.status).toBe(401)
    expect(worker).not.toHaveBeenCalled()
  },
)

it('refuses to run when CRON_SECRET is absent', async () => {
  vi.stubEnv('CRON_SECRET', '')
  const response = await GET(new NextRequest('http://localhost/api/cron/sheets-outbox', {
    headers: { authorization: 'Bearer cron-only-test-secret' },
  }))
  expect(response.status).toBe(401)
  expect(worker).not.toHaveBeenCalled()
})
