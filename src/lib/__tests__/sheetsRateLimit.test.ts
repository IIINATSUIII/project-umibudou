import { it, expect, vi, beforeEach } from 'vitest'
import { HEADERS } from '../storeSchema'
import { RateLimitedError } from '../withRetry'

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  append: vi.fn(),
  batchUpdate: vi.fn(),
}))
vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    sheets: () => ({
      spreadsheets: {
        values: { get: mock.get, append: mock.append, batchUpdate: mock.batchUpdate },
      },
    }),
  },
}))
vi.mock('../storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => work(),
}))
import { getReservations, addReservation, updateReservation } from '../sheets'

const tooMany = () => Object.assign(new Error('Quota exceeded'), { code: 429 })
const rows = (reservations: Array<Record<string, string>> = []) => ({
  data: {
    values: [
      HEADERS.RESERVATIONS,
      ...reservations.map((r) => HEADERS.RESERVATIONS.map((h) => r[h] ?? '')),
    ],
  },
})
const existing = {
  id: 'R-20261010-1',
  guestName: '山田 太郎',
  guestCount: '2',
  status: 'STS-03',
  diveDate: '2026-10-10',
}

beforeEach(() => {
  mock.get.mockReset()
  mock.append.mockReset()
  mock.batchUpdate.mockReset()
})

it('読取: 429で拒否されても再送して取得できる(MSG-17の再試行)', async () => {
  mock.get.mockRejectedValueOnce(tooMany()).mockResolvedValueOnce(rows([existing]))

  const result = await getReservations()

  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ id: 'R-20261010-1', guestName: '山田 太郎' })
  expect(mock.get).toHaveBeenCalledTimes(2)
})

it('読取: 429が続いて再試行を使い切ると RateLimitedError になる', async () => {
  mock.get.mockRejectedValue(tooMany())

  await expect(getReservations()).rejects.toBeInstanceOf(RateLimitedError)
  expect(mock.get).toHaveBeenCalledTimes(3)
}, 10000)

it('読取: 429以外のエラーは再送せず、そのまま投げる', async () => {
  mock.get.mockRejectedValue(Object.assign(new Error('boom'), { code: 500 }))

  await expect(getReservations()).rejects.toThrow('boom')
  expect(mock.get).toHaveBeenCalledTimes(1)
})

it('追記: 429で拒否された追記だけを再送し、二重に追記しない', async () => {
  mock.get.mockResolvedValue(rows())
  mock.append.mockRejectedValueOnce(tooMany()).mockResolvedValueOnce({ data: {} })

  await addReservation({ ...existing, id: 'R-20261010-2' } as never)

  // 追記の呼び出しは「拒否1回＋成功1回」。読取(重複ID確認)は再送の対象外で1回だけ
  expect(mock.append).toHaveBeenCalledTimes(2)
  expect(mock.get).toHaveBeenCalledTimes(1)
})

it('更新: 429で拒否された更新を再送して反映できる', async () => {
  mock.get.mockResolvedValue(rows([existing]))
  mock.batchUpdate.mockRejectedValueOnce(tooMany()).mockResolvedValueOnce({ data: {} })

  await updateReservation('R-20261010-1', { status: 'STS-04' })

  expect(mock.batchUpdate).toHaveBeenCalledTimes(2)
  const sent = mock.batchUpdate.mock.calls[1][0].requestBody.data
  expect(sent).toHaveLength(1)
  expect(sent[0].values).toEqual([['STS-04']])
})

it('更新: 429が続くと RateLimitedError になり、成功扱いにならない', async () => {
  mock.get.mockResolvedValue(rows([existing]))
  mock.batchUpdate.mockRejectedValue(tooMany())

  await expect(updateReservation('R-20261010-1', { status: 'STS-04' })).rejects.toBeInstanceOf(
    RateLimitedError
  )
  expect(mock.batchUpdate).toHaveBeenCalledTimes(3)
}, 10000)
