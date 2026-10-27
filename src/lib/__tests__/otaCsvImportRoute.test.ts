import { it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({ importOtaCsv: vi.fn() }))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'odp_session',
  verifySessionToken: async (token: string) => token === 'staff-session' ? { email: 'staff@example.com' } : null,
}))
vi.mock('@/lib/otaCsvImport', async () => {
  const { CsvFormatError } = await import('../csvParse')
  return { CsvFormatError, importOtaCsv: mock.importOtaCsv, OTA_CSV_MAX_CHARS: 100 }
})
import { POST } from '../../app/api/reservations/import/route'
import { CsvFormatError } from '../csvParse'
import { MSG } from '../messages'

const post = (body: unknown, cookie = 'odp_session=staff-session') =>
  POST(new NextRequest('http://localhost/api/reservations/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }))

it('スタッフ以外は401で、取込処理を呼ばない', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-session-secret')
  try {
    const res = await post({ csv: 'a' }, '')
    expect(res.status).toBe(401)
    expect(mock.importOtaCsv).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
  }
})

it('形式不正は400とMSG-14、理由を返す', async () => {
  mock.importOtaCsv.mockRejectedValueOnce(new CsvFormatError('必要な列がありません: 人数'))
  const res = await post({ csv: 'a' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: MSG.CSV_FORMAT, detail: '必要な列がありません: 人数' })
})

it('大きすぎるCSVは413', async () => {
  expect((await post({ csv: 'x'.repeat(101) })).status).toBe(413)
})

it('dryRunを渡して結果を返す', async () => {
  mock.importOtaCsv.mockResolvedValueOnce({ dryRun: true, imported: 0, ready: 1, duplicates: 0, invalid: 0, rows: [] })
  const res = await post({ csv: 'a', dryRun: true })
  expect(res.status).toBe(200)
  expect(mock.importOtaCsv).toHaveBeenLastCalledWith('a', { dryRun: true })
})
