import { it, expect, vi, beforeEach } from 'vitest'

const mock = vi.hoisted(() => ({ get: vi.fn(), append: vi.fn(), batchUpdate: vi.fn() }))
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    sheets: () => ({
      spreadsheets: { values: { get: mock.get, append: mock.append, batchUpdate: mock.batchUpdate } },
    }),
  },
}))
vi.mock('../storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => work(),
}))
import { HEADERS, getReservations, addReservation, updateReservation } from '../sheets'
import { cachedRead, resetReadCacheForTests } from '../readCache'

const existing = { id: 'R-20261010-1', guestName: '山田 太郎', guestCount: '2', status: 'STS-03', diveDate: '2026-10-10' }
const sheet = { data: { values: [HEADERS.RESERVATIONS, HEADERS.RESERVATIONS.map((h) => (existing as Record<string, string>)[h] ?? '')] } }

beforeEach(() => {
  resetReadCacheForTests()
  mock.get.mockReset().mockResolvedValue(sheet)
  mock.append.mockReset().mockResolvedValue({})
  mock.batchUpdate.mockReset().mockResolvedValue({})
})

const listRead = () => cachedRead('RESERVATIONS', () => getReservations())

it('更新後の一覧読取はキャッシュを使わずSheetsを読み直す', async () => {
  await listRead()
  await listRead()
  expect(mock.get).toHaveBeenCalledTimes(1)

  await updateReservation(existing.id, { staffNote: 'メモ' })
  const before = mock.get.mock.calls.length
  await listRead()
  expect(mock.get).toHaveBeenCalledTimes(before + 1)
})

it('追加後の一覧読取はキャッシュを使わずSheetsを読み直す', async () => {
  await listRead()
  await addReservation({
    id: 'R-20261011-1', diveDate: '2026-10-11', courseName: '体験', guestName: '佐藤', guestPhone: '090',
    guestCount: 1, timeSlot: 'morning', channel: 'phone', status: 'STS-03',
  })
  const before = mock.get.mock.calls.length
  await listRead()
  expect(mock.get).toHaveBeenCalledTimes(before + 1)
})
