import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { Reservation } from '@/types'

const { getReservations, updateReservation } = vi.hoisted(() => ({
  getReservations: vi.fn(),
  updateReservation: vi.fn(),
}))
vi.mock('@/lib/dataStore', () => ({
  store: { getReservations, addReservation: vi.fn(), updateReservation },
}))

let generateReservationId: typeof import('../reservations').generateReservationId
let hasUpdateConflict: typeof import('../reservations').hasUpdateConflict
let patchReservation: typeof import('../reservations').patchReservation

beforeAll(async () => {
  ({ generateReservationId, hasUpdateConflict, patchReservation } = await import('../reservations'))
})

function fakeReservation(id: string): Reservation {
  return { id } as unknown as Reservation
}

describe('generateReservationId', () => {
  beforeEach(() => getReservations.mockReset())

  it('該当日の予約がなければ連番001を採番する', async () => {
    getReservations.mockResolvedValue([])
    expect(await generateReservationId('2026-09-10')).toBe('R-20260910-001')
  })

  it('同日の既存予約数+1を連番として採番する（3桁ゼロ埋め）', async () => {
    getReservations.mockResolvedValue([
      fakeReservation('R-20260910-001'),
      fakeReservation('R-20260910-002'),
      fakeReservation('R-20260911-001'), // 別日はカウントしない
    ])
    expect(await generateReservationId('2026-09-10')).toBe('R-20260910-003')
  })
})

describe('hasUpdateConflict', () => {
  it('現在のレコードが存在せず比較しようがない場合はfalse', () => {
    expect(hasUpdateConflict(undefined, '2026-09-10T00:00:00.000Z')).toBe(false)
  })

  it('updatedAtが一致していればfalse（競合なし）', () => {
    const current = { updatedAt: '2026-09-10T00:00:00.000Z' }
    expect(hasUpdateConflict(current, '2026-09-10T00:00:00.000Z')).toBe(false)
  })

  it('updatedAtが食い違っていればtrue（後勝ち検知、MSG-20対象）', () => {
    const current = { updatedAt: '2026-09-10T09:00:00.000Z' }
    expect(hasUpdateConflict(current, '2026-09-10T00:00:00.000Z')).toBe(true)
  })
})

describe('patchReservation', () => {
  beforeEach(() => updateReservation.mockReset())

  it('書き込んだ最終更新日時を返し、ストアにも同じ値を渡す（画面が次の更新で使うため）', async () => {
    const returned = await patchReservation('R-20260910-001', { status: 'STS-03' })

    expect(updateReservation).toHaveBeenCalledTimes(1)
    const [id, patch] = updateReservation.mock.calls[0]
    expect(id).toBe('R-20260910-001')
    expect(patch.status).toBe('STS-03')
    expect(returned).toBe(patch.updatedAt)
    expect(Number.isNaN(Date.parse(returned))).toBe(false)
  })
})
