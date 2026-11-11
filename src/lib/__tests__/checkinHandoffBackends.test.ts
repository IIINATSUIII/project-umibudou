import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(), values: vi.fn(), update: vi.fn(), batch: vi.fn(), query: vi.fn(), transactionQuery: vi.fn(),
  reserve: vi.fn(), invalidate: vi.fn(),
}))
vi.mock('googleapis', () => ({ google: {
  auth: { GoogleAuth: class {} },
  sheets: () => ({ spreadsheets: { get: mocks.metadata, batchUpdate: mocks.batch, values: { get: mocks.values, update: mocks.update } } }),
} }))
vi.mock('../db', () => ({ query: mocks.query, withTransaction: (work: (client: unknown) => Promise<unknown>) => work({ query: mocks.transactionQuery }) }))
vi.mock('../storeLock', () => ({ withStoreWriteLock: (work: () => Promise<unknown>) => work() }))
vi.mock('../readCache', () => ({ reserveSharedSheetsReadSlot: mocks.reserve, invalidateReadCache: mocks.invalidate, cachedRead: (_key: string, work: () => Promise<unknown>) => work() }))
import { enqueueCheckinHandoff, listCheckinHandoffs } from '../checkinHandoffStore'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.metadata.mockResolvedValue({ data: { sheets: [{ properties: { title: '受付待ち' } }] } })
  mocks.values.mockResolvedValue({ data: { values: [['id', 'questionnaireId', 'createdAt', 'expiresAt']] } })
})
afterEach(() => vi.unstubAllEnvs())

it('reserves shared Sheets read slots before each read and invalidates after a write', async () => {
  vi.stubEnv('DATA_STORE', 'sheets')
  await enqueueCheckinHandoff('Q1', new Date(Date.now() + 60000).toISOString())
  expect(mocks.reserve).toHaveBeenCalledTimes(3)
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ valueInputOption: 'RAW', requestBody: { values: [
    ['id', 'questionnaireId', 'createdAt', 'expiresAt'], [expect.any(String), 'Q1', expect.any(String), expect.any(String)],
  ] } }))
  expect(mocks.invalidate).toHaveBeenCalledOnce()
})

it('does not issue a Sheets read when the shared read quota is exhausted', async () => {
  vi.stubEnv('DATA_STORE', 'sheets')
  mocks.reserve.mockRejectedValue(new Error('capacity reached'))
  await expect(listCheckinHandoffs()).rejects.toThrow('capacity reached')
  expect(mocks.metadata).not.toHaveBeenCalled()
})

it('invalidates uncertain Sheets writes so cached pending data is not retained', async () => {
  vi.stubEnv('DATA_STORE', 'sheets')
  mocks.update.mockRejectedValue(new Error('connection lost'))
  await expect(enqueueCheckinHandoff('Q1', new Date(Date.now() + 60000).toISOString())).rejects.toThrow('connection lost')
  expect(mocks.invalidate).toHaveBeenCalledOnce()
})

it('uses PostgreSQL transaction and unique questionnaire conflict handling', async () => {
  vi.stubEnv('DATA_STORE', 'postgres')
  const expiry = new Date(Date.now() + 60000).toISOString()
  await enqueueCheckinHandoff('Q1', expiry)
  expect(mocks.transactionQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('ON CONFLICT (questionnaire_id) DO NOTHING'), [expect.any(String), 'Q1', expiry])
  expect(mocks.metadata).not.toHaveBeenCalled()
  mocks.query.mockResolvedValue({ rows: [{ id: 'item', questionnaireId: 'Q1', createdAt: new Date('2026-11-11T00:00:00Z'), expiresAt: new Date(expiry) }] })
  expect(await listCheckinHandoffs()).toEqual([{ id: 'item', questionnaireId: 'Q1', createdAt: '2026-11-11T00:00:00.000Z', expiresAt: expiry }])
})
