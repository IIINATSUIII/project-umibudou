import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { patchReservation, ReservationConflictError } from '../reservations'
import { getReservations } from '../localStore'

// 本物のローカルJSONストアと、本物の patchReservation(ロック内で比較→書込)を使う。
let directory: string
const file = () => path.join(directory, 'reservations.json')
const seed = (rows: Array<Record<string, unknown>>) => fs.writeFile(file(), JSON.stringify(rows))
const row = (over: Record<string, unknown> = {}) => ({
  id: 'R-1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  guestName: '山田 太郎',
  guestPhone: '090-1234-5678',
  guestEmail: 'taro@example.com',
  diveDate: '2026-10-20',
  timeSlot: 'morning',
  courseId: 'CRS-001',
  courseName: '体験ダイビング',
  guestCount: 2,
  status: 'STS-01',
  channel: 'phone',
  questionnaireCompleted: false,
  ...over,
})
const current = async (id = 'R-1') => (await getReservations()).find((r) => r.id === id)!

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odp-conflict-test-'))
  vi.stubEnv('LOCAL_DATA_DIR', directory)
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('patchReservation(ロック内の比較→書込)', () => {
  it('版が一致すれば更新でき、返した更新日時が保存され、版が進む', async () => {
    await seed([row()])

    const updatedAt = await patchReservation('R-1', { status: 'STS-03' }, '2026-10-01T00:00:00.000Z')

    const saved = await current()
    expect(saved.status).toBe('STS-03')
    expect(saved.updatedAt).toBe(updatedAt)
    expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse('2026-10-01T00:00:00.000Z'))
  })

  it('古い版での更新は ReservationConflictError(MSG-20)で拒否し、データを変えない', async () => {
    await seed([row({ updatedAt: '2026-10-02T00:00:00.000Z' })])

    await expect(
      patchReservation('R-1', { status: 'STS-04' }, '2026-10-01T00:00:00.000Z')
    ).rejects.toBeInstanceOf(ReservationConflictError)

    const saved = await current()
    expect(saved.status).toBe('STS-01')
    expect(saved.updatedAt).toBe('2026-10-02T00:00:00.000Z')
  })

  it('直前の更新が返した更新日時を使えば、続けて更新しても誤って競合にならない', async () => {
    await seed([row()])

    const v1 = await patchReservation('R-1', { status: 'STS-02' }, '2026-10-01T00:00:00.000Z')
    const v2 = await patchReservation('R-1', { status: 'STS-03' }, v1)

    expect((await current()).status).toBe('STS-03')
    expect(Date.parse(v2)).toBeGreaterThan(Date.parse(v1))
  })

  it('読み込み時点の版を渡さない/空文字の場合も、現在の版と食い違えば競合として扱う', async () => {
    await seed([row()])

    await expect(patchReservation('R-1', { status: 'STS-03' }, '')).rejects.toBeInstanceOf(
      ReservationConflictError
    )
  })

  it('同じ版から2人が同時に更新すると、成功するのは1人だけで、もう1人は競合になる', async () => {
    await seed([row()])
    const version = '2026-10-01T00:00:00.000Z'

    const results = await Promise.allSettled([
      patchReservation('R-1', { status: 'STS-02' }, version),
      patchReservation('R-1', { status: 'STS-05' }, version),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(ReservationConflictError)
    // 勝った方の値だけが保存されている(両方が混ざったり、負けた方が上書きしていない)
    const winner = (ok[0] as PromiseFulfilledResult<string>).value
    const saved = await current()
    expect(saved.updatedAt).toBe(winner)
    expect(['STS-02', 'STS-05']).toContain(saved.status)
  })

  it('別々の予約への同時更新は互いに影響しない(どちらも成功する)', async () => {
    await seed([row({ id: 'R-1' }), row({ id: 'R-2' })])
    const version = '2026-10-01T00:00:00.000Z'

    await Promise.all([
      patchReservation('R-1', { status: 'STS-03' }, version),
      patchReservation('R-2', { status: 'STS-04' }, version),
    ])

    expect((await current('R-1')).status).toBe('STS-03')
    expect((await current('R-2')).status).toBe('STS-04')
  })

  it('存在しない予約の更新は、成功扱いにせずエラーにする', async () => {
    await seed([row()])

    await expect(patchReservation('R-404', { status: 'STS-03' }, 'x')).rejects.toThrow()
  })
})
