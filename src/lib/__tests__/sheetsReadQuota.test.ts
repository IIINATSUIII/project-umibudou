import { it, expect, vi, beforeEach, describe } from 'vitest'
import { RateLimitedError } from '../withRetry'

const mock = vi.hoisted(() => ({
  getSheetValues: vi.fn(),
  getReservations: vi.fn(),
  addReservation: vi.fn(),
  lock: vi.fn(),
}))
vi.mock('../sheets', () => ({ getSheetValues: mock.getSheetValues }))
vi.mock('../dataStore', () => ({
  USE_SHEETS: true,
  store: { getReservations: mock.getReservations, addReservation: mock.addReservation },
}))
vi.mock('../storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => {
    mock.lock()
    return work()
  },
}))

import {
  cachedRead,
  invalidateReadCache,
  resetReadCacheForTests,
  READ_CACHE_TTL_MS,
  READ_CACHE_STALE_ON_RATE_LIMIT_MS,
} from '../readCache'
import {
  importGoogleFormBookings,
  resetGoogleFormImportForTests,
  FORM_IMPORT_MIN_INTERVAL_MS,
} from '../googleFormImport'
import { nextPollDelay, POLL_INTERVAL_MS, POLL_MAX_INTERVAL_MS } from '../usePolling'

let clock = 0
const now = () => clock

beforeEach(() => {
  clock = 1_000_000
  resetReadCacheForTests()
  resetGoogleFormImportForTests()
  mock.getSheetValues.mockReset()
  mock.getReservations.mockReset()
  mock.addReservation.mockReset()
  mock.lock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('一覧用読取キャッシュ', () => {
  it('TTL内は何画面から読んでも1回だけ読む', async () => {
    const load = vi.fn(async () => ['R-1'])
    await Promise.all([cachedRead('K', load, { now }), cachedRead('K', load, { now }), cachedRead('K', load, { now })])
    clock += READ_CACHE_TTL_MS - 1
    expect(await cachedRead('K', load, { now })).toEqual(['R-1'])
    expect(load).toHaveBeenCalledTimes(1)

    clock += 1
    await cachedRead('K', load, { now })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('書込後は次の読取で再取得し、書込前に始まった読取は保存しない', async () => {
    let resolveFirst: (v: string[]) => void = () => undefined
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(['after-write'])

    const inFlight = cachedRead('K', load, { now })
    await Promise.resolve()
    invalidateReadCache()
    // 書込後に来た読取は書込前の読取に相乗りしない
    expect(await cachedRead('K', load, { now })).toEqual(['after-write'])
    resolveFirst(['before-write'])
    expect(await inFlight).toEqual(['before-write'])
    expect(await cachedRead('K', load, { now })).toEqual(['after-write'])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('API制限時は取得済みの値で代替し、古すぎる場合はエラーを返す', async () => {
    const load = vi.fn().mockResolvedValueOnce(['old']).mockRejectedValue(new RateLimitedError('limited'))
    await cachedRead('K', load, { now })
    clock += READ_CACHE_TTL_MS
    expect(await cachedRead('K', load, { now })).toEqual(['old'])

    clock += READ_CACHE_STALE_ON_RATE_LIMIT_MS
    await expect(cachedRead('K', load, { now })).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('自分の書込後は、API制限でも書込前の値で画面を巻き戻さない', async () => {
    const load = vi.fn().mockResolvedValueOnce(['before-write']).mockRejectedValue(new RateLimitedError('limited'))
    await cachedRead('K', load, { now })
    invalidateReadCache()
    await expect(cachedRead('K', load, { now })).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('force はTTL内でも読み直し、結果を以後の読取で使う', async () => {
    const load = vi.fn().mockResolvedValueOnce(['cached']).mockResolvedValueOnce(['latest'])
    await cachedRead('K', load, { now })
    expect(await cachedRead('K', load, { now, force: true })).toEqual(['latest'])
    expect(await cachedRead('K', load, { now })).toEqual(['latest'])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('API制限以外の失敗は代替しない', async () => {
    const load = vi.fn().mockResolvedValueOnce(['old']).mockRejectedValue(new Error('boom'))
    await cachedRead('K', load, { now })
    clock += READ_CACHE_TTL_MS
    await expect(cachedRead('K', load, { now })).rejects.toThrow('boom')
  })
})

describe('Googleフォーム取込の間引き', () => {
  const header = ['タイムスタンプ', '希望日', '希望時間', 'コース', 'お名前', '人数', '電話番号']
  const row = ['2026/10/01 10:00', '2026/10/20', '09:00', '体験', '山田 太郎', '2', '090-0000-0000']

  it('最短間隔内の呼出しは回答タブを読み直さない', async () => {
    mock.getSheetValues.mockResolvedValue([header])
    await importGoogleFormBookings(now)
    clock += FORM_IMPORT_MIN_INTERVAL_MS - 1
    await importGoogleFormBookings(now)
    expect(mock.getSheetValues).toHaveBeenCalledTimes(1)

    clock += 1
    await importGoogleFormBookings(now)
    expect(mock.getSheetValues).toHaveBeenCalledTimes(2)
  })

  it('新しい行が無ければ予約シートを読まず、ロックも取らない', async () => {
    mock.getSheetValues.mockResolvedValue([header, row])
    mock.getReservations.mockResolvedValue([])
    mock.addReservation.mockResolvedValue(undefined)

    expect((await importGoogleFormBookings(now)).imported).toBe(1)
    const readsAfterFirst = mock.getReservations.mock.calls.length
    expect(mock.lock).toHaveBeenCalledTimes(1)

    clock += FORM_IMPORT_MIN_INTERVAL_MS
    const second = await importGoogleFormBookings(now)
    expect(second).toMatchObject({ imported: 0, skipped: 1 })
    expect(mock.getReservations).toHaveBeenCalledTimes(readsAfterFirst)
    expect(mock.lock).toHaveBeenCalledTimes(1)
  })

  it('取込済みの行は予約シートで確認して二重登録しない', async () => {
    mock.getSheetValues.mockResolvedValue([header, row])
    mock.addReservation.mockResolvedValue(undefined)
    mock.getReservations.mockResolvedValue([])
    await importGoogleFormBookings(now)
    const importedId = mock.addReservation.mock.calls[0][0].id

    resetGoogleFormImportForTests() // 別インスタンス相当（既知IDなし）
    mock.getReservations.mockResolvedValue([{ id: importedId }])
    expect(await importGoogleFormBookings(now)).toMatchObject({ imported: 0, skipped: 1 })
    expect(mock.addReservation).toHaveBeenCalledTimes(1)
  })

  it('取込済みの行は、後から不正になっていても検証エラーにしない', async () => {
    mock.getSheetValues.mockResolvedValue([header, row])
    mock.addReservation.mockResolvedValue(undefined)
    mock.getReservations.mockResolvedValue([])
    await importGoogleFormBookings(now)
    const importedId = mock.addReservation.mock.calls[0][0].id

    resetGoogleFormImportForTests() // 再起動相当
    const edited = [...row]
    edited[2] = '' // 希望時間を消す
    mock.getSheetValues.mockResolvedValue([header, edited])
    mock.getReservations.mockResolvedValue([{ id: importedId }])
    expect(await importGoogleFormBookings(now)).toMatchObject({ imported: 0, skipped: 1, errors: [] })
  })

  it('ロック待ち・API制限でも例外にせず、一覧表示を止めない', async () => {
    mock.getSheetValues.mockResolvedValue([header, row])
    mock.getReservations.mockRejectedValue(new RateLimitedError('limited'))
    const result = await importGoogleFormBookings(now)
    expect(result.imported).toBe(0)
    expect(result.errors).toEqual(['予約の取込を完了できませんでした。次回の更新で再試行します'])
  })
})

it('自動更新は失敗が続くと間隔を伸ばし、上限で止まる', () => {
  expect(nextPollDelay(0)).toBe(POLL_INTERVAL_MS)
  expect(nextPollDelay(1)).toBe(POLL_INTERVAL_MS * 2)
  expect(nextPollDelay(10)).toBe(POLL_MAX_INTERVAL_MS)
})
