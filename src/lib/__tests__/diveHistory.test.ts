import { describe, it, expect } from 'vitest'
import { buildDiveHistory } from '../diveHistory'
import type { Reservation } from '@/types'

const reservation = (over: Partial<Reservation>): Reservation => ({
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
  guestCount: 1,
  status: 'STS-05',
  channel: 'phone',
  questionnaireCompleted: true,
  ...over,
})

describe('buildDiveHistory', () => {
  it('その顧客に紐づく予約だけを日付の新しい順で返す', () => {
    const list = [
      reservation({ id: 'R-1', customerId: 'C-1', diveDate: '2026-08-01' }),
      reservation({ id: 'R-2', customerId: 'C-2', diveDate: '2026-09-01' }),
      reservation({ id: 'R-3', customerId: 'C-1', diveDate: '2026-10-01' }),
      reservation({ id: 'R-4', diveDate: '2026-10-05' }),
    ]

    const history = buildDiveHistory('C-1', list)

    expect(history.map((h) => h.reservationId)).toEqual(['R-3', 'R-1'])
  })

  it('同じ日付なら予約IDの降順で並べ、順序が安定する', () => {
    const list = [
      reservation({ id: 'R-A', customerId: 'C-1', diveDate: '2026-10-01' }),
      reservation({ id: 'R-B', customerId: 'C-1', diveDate: '2026-10-01' }),
    ]

    expect(buildDiveHistory('C-1', list).map((h) => h.reservationId)).toEqual(['R-B', 'R-A'])
  })

  it('コース名・ポイント・ステータス名を画面表示用に整える', () => {
    const list = [
      reservation({ customerId: 'C-1', courseName: 'ファンダイビング', divePoint: '青の洞窟', status: 'STS-05' }),
    ]

    expect(buildDiveHistory('C-1', list)).toEqual([
      {
        reservationId: 'R-1',
        date: '2026-10-20',
        courseName: 'ファンダイビング',
        divePoint: '青の洞窟',
        statusName: '実施済',
        cancelled: false,
      },
    ])
  })

  it('ポイント未設定は空文字、キャンセルは cancelled=true で履歴に残す', () => {
    const [item] = buildDiveHistory('C-1', [reservation({ customerId: 'C-1', status: 'STS-04' })])

    expect(item.divePoint).toBe('')
    expect(item.statusName).toBe('キャンセル')
    expect(item.cancelled).toBe(true)
  })

  it('履歴が無い顧客・顧客ID未指定は空配列(他人の予約を返さない)', () => {
    const list = [reservation({ customerId: 'C-1' }), reservation({ id: 'R-2' })]

    expect(buildDiveHistory('C-9', list)).toEqual([])
    expect(buildDiveHistory('', list)).toEqual([])
  })

  it('元の配列を並べ替えて変更しない', () => {
    const list = [
      reservation({ id: 'R-1', customerId: 'C-1', diveDate: '2026-08-01' }),
      reservation({ id: 'R-3', customerId: 'C-1', diveDate: '2026-10-01' }),
    ]
    const before = list.map((r) => r.id)

    buildDiveHistory('C-1', list)

    expect(list.map((r) => r.id)).toEqual(before)
  })
})
