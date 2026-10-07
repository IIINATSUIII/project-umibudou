import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { patchReservation as patchFromScreen, ApiRequestError } from '../api'

const mock = vi.hoisted(() => ({ patchReservation: vi.fn() }))
vi.mock('@/lib/dataStore', () => ({ store: { getReservations: vi.fn() } }))
vi.mock('@/lib/googleFormImport', () => ({ importGoogleFormBookings: vi.fn() }))
vi.mock('@/lib/reservations', () => ({
  createReservation: vi.fn(),
  patchReservation: mock.patchReservation,
  ReservationConflictError: class ReservationConflictError extends Error {},
}))
import { PATCH } from '../../app/api/reservations/route'

const CONFLICT = '他のスタッフが先に更新した可能性があります。最新の内容をご確認ください。'

describe('画面側 patchReservation(api.ts)', () => {
  const stub = (status: number, body: unknown, jsonFails = false) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (jsonFails) throw new Error('not json')
        return body
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }
  afterEach(() => vi.unstubAllGlobals())

  it('読み込み時点の更新日時(expectedUpdatedAt)を必ず送る', async () => {
    const fetchMock = stub(200, { ok: true, updatedAt: '2026-10-07T01:00:00.000Z' })

    await patchFromScreen('R-1', { status: 'STS-03' }, '2026-10-07T00:00:00.000Z')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/reservations')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      id: 'R-1',
      status: 'STS-03',
      expectedUpdatedAt: '2026-10-07T00:00:00.000Z',
    })
  })

  it('成功時はサーバーが返した新しい更新日時を返す(続けて更新しても誤って409にならない)', async () => {
    stub(200, { ok: true, updatedAt: '2026-10-07T01:00:00.000Z' })

    await expect(patchFromScreen('R-1', { status: 'STS-03' }, 'x')).resolves.toBe(
      '2026-10-07T01:00:00.000Z'
    )
  })

  it('409はステータス付きの ApiRequestError として投げる(画面がMSG-20を出して再取得できる)', async () => {
    stub(409, { error: CONFLICT, conflict: true })

    const error = await patchFromScreen('R-1', { status: 'STS-04' }, 'old').catch((e) => e)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.status).toBe(409)
    expect(error.message).toBe(CONFLICT)
  })

  it('JSONでない失敗応答でも、既定のメッセージとステータスで投げる', async () => {
    stub(500, null, true)

    const error = await patchFromScreen('R-1', { status: 'STS-03' }, 'x').catch((e) => e)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.status).toBe(500)
    expect(error.message).toBe('保存に失敗しました')
  })

  it('成功応答に更新日時が無い場合は、成功扱いにせず例外にする', async () => {
    stub(200, { ok: true })

    await expect(patchFromScreen('R-1', { status: 'STS-03' }, 'x')).rejects.toThrow(
      '更新結果を確認できませんでした'
    )
  })
})

describe('PATCH /api/reservations(サーバー側の競合検知)', () => {
  const call = (body: unknown) =>
    PATCH(
      new NextRequest('http://localhost/api/reservations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mock.patchReservation.mockReset()
  })

  it('expectedUpdatedAt を省略した更新は400で拒否し、書き込まない(必須)', async () => {
    const res = await call({ id: 'R-1', status: 'STS-03' })

    expect(res.status).toBe(400)
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it('成功時は新しい更新日時を返し、読込時の版をストア層へ渡す', async () => {
    mock.patchReservation.mockResolvedValue('2026-10-07T01:00:00.000Z')

    const res = await call({ id: 'R-1', status: 'STS-03', expectedUpdatedAt: 'v0' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, updatedAt: '2026-10-07T01:00:00.000Z' })
    expect(mock.patchReservation).toHaveBeenCalledWith('R-1', { status: 'STS-03' }, 'v0')
  })

  it('古い版での更新は409と conflict:true を返す(MSG-20)', async () => {
    const { ReservationConflictError } = await import('@/lib/reservations')
    mock.patchReservation.mockRejectedValue(new ReservationConflictError(CONFLICT))

    const res = await call({ id: 'R-1', status: 'STS-04', expectedUpdatedAt: 'old' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CONFLICT, conflict: true })
  })

  it('更新を許可する項目だけを渡す(顧客IDや問診完了フラグなどは無視)', async () => {
    mock.patchReservation.mockResolvedValue('v1')

    await call({
      id: 'R-1',
      status: 'STS-03',
      staffNote: 'メモ',
      customerId: 'C-999',
      questionnaireCompleted: true,
      expectedUpdatedAt: 'v0',
    })

    expect(mock.patchReservation).toHaveBeenCalledWith(
      'R-1',
      { status: 'STS-03', staffNote: 'メモ' },
      'v0'
    )
  })

  it('存在しないステータスは400で拒否し、書き込まない', async () => {
    const res = await call({ id: 'R-1', status: 'STS-99', expectedUpdatedAt: 'v0' })

    expect(res.status).toBe(400)
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it('更新項目が1つも無い場合は400で拒否する', async () => {
    const res = await call({ id: 'R-1', customerId: 'C-999', expectedUpdatedAt: 'v0' })

    expect(res.status).toBe(400)
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })
})
