import { describe, it, expect, vi, afterEach } from 'vitest'
import { patchReservation } from '../api'

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('patchReservation（画面側の更新・競合検知）', () => {
  it('成功時はサーバーが返した最終更新日時を返す', async () => {
    stubFetch(200, { ok: true, updatedAt: '2026-10-06T02:00:00.000Z' })

    await expect(patchReservation('R-1', { status: 'STS-03' }, '2026-10-06T01:00:00.000Z'))
      .resolves.toEqual({ status: 'ok', updatedAt: '2026-10-06T02:00:00.000Z' })
  })

  it('読み込み時点のupdatedAtをexpectedUpdatedAtとして送る', async () => {
    const fetchMock = stubFetch(200, { ok: true, updatedAt: 'x' })

    await patchReservation('R-1', { status: 'STS-03' }, '2026-10-06T01:00:00.000Z')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ id: 'R-1', status: 'STS-03', expectedUpdatedAt: '2026-10-06T01:00:00.000Z' })
  })

  it('expectedUpdatedAtを渡さなければ送らない（従来の呼び出しは競合チェックされない）', async () => {
    const fetchMock = stubFetch(200, { ok: true, updatedAt: 'x' })

    await patchReservation('R-1', { status: 'STS-03' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('expectedUpdatedAt')
  })

  it('409は競合として返し、MSG-20のメッセージを持つ', async () => {
    stubFetch(409, { error: '他のスタッフが先に更新した可能性があります。最新の内容をご確認ください。', conflict: true })

    await expect(patchReservation('R-1', { status: 'STS-04' }, 'old'))
      .resolves.toEqual({
        status: 'conflict',
        message: '他のスタッフが先に更新した可能性があります。最新の内容をご確認ください。',
      })
  })

  it('409以外の失敗はエラーとして返し、サーバーのメッセージを使う', async () => {
    stubFetch(503, { error: '通信が集中しています。しばらく経ってから再度お試しください。' })

    await expect(patchReservation('R-1', { status: 'STS-03' }))
      .resolves.toEqual({ status: 'error', message: '通信が集中しています。しばらく経ってから再度お試しください。' })
  })

  it('レスポンスがJSONでなくても既定のエラーメッセージで返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    }))

    await expect(patchReservation('R-1', { status: 'STS-03' }))
      .resolves.toEqual({ status: 'error', message: '更新に失敗しました。' })
  })
})
