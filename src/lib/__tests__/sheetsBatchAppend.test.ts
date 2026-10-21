import { it, expect, vi, beforeEach } from 'vitest'

const mock = vi.hoisted(() => ({ get: vi.fn(), append: vi.fn() }))
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    sheets: () => ({ spreadsheets: { values: { get: mock.get, append: mock.append } } }),
  },
}))
vi.mock('../storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => work(),
}))
import { HEADERS, addReservations } from '../sheets'

const reservation = (id: string) => ({
  id, diveDate: '2026-11-03', courseName: '体験ダイビング', guestName: '山田', guestPhone: '090',
  guestCount: 1, timeSlot: 'morning' as const, channel: 'ota' as const, status: 'STS-03',
})

beforeEach(() => {
  mock.get.mockReset().mockResolvedValue({ data: { values: [HEADERS.RESERVATIONS] } })
  mock.append.mockReset().mockResolvedValue({})
})

it('OTA-CSVの複数行は1回の読取と1回の追記で保存する（読取枠を使い切らない）', async () => {
  await addReservations([reservation('R-OTA-1'), reservation('R-OTA-2'), reservation('R-OTA-3')])

  expect(mock.get).toHaveBeenCalledTimes(1)
  expect(mock.append).toHaveBeenCalledTimes(1)
  const values = mock.append.mock.calls[0][0].requestBody.values
  expect(values).toHaveLength(3)
  expect(values[0][HEADERS.RESERVATIONS.indexOf('id')]).toBe('R-OTA-1')
})

it('既存IDと重複する行があれば何も書き込まない', async () => {
  const row = HEADERS.RESERVATIONS.map((h) => (h === 'id' ? 'R-OTA-2' : h === 'diveDate' ? '2026-11-03' : ''))
  mock.get.mockResolvedValue({ data: { values: [HEADERS.RESERVATIONS, row] } })

  await expect(addReservations([reservation('R-OTA-1'), reservation('R-OTA-2')])).rejects.toThrow('登録済み')
  expect(mock.append).not.toHaveBeenCalled()
})
