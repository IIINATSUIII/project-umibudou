import { describe, expect, it } from 'vitest'
import {
  cancellationReasonFromRequest,
  cancellationRequestDeadline,
  cancellationRequestEligibility,
  hasPendingCancellationRequest,
  normalizeCancellationRequestNote,
  publicCancellationView,
} from '../cancellationRequest'
import { reservationMatchesCategory } from '../reservationStatus'
import { normalizeReservation, HEADERS } from '../storeSchema'
import type { Reservation } from '@/types'

const reservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  id: 'R-1',
  guestName: '山田 太郎',
  guestPhone: '090-1234-5678',
  diveDate: '2026-12-10',
  timeSlot: 'morning',
  courseName: '体験ダイビング',
  guestCount: 2,
  status: 'STS-03',
  channel: 'hp',
  staffNote: '送迎あり',
  ...overrides,
})

describe('Issue #97 キャンセル申請の締切', () => {
  it('ダイブ日の前日18:00（日本時間）を締切にする', () => {
    expect(cancellationRequestDeadline('2026-12-10')?.toISOString()).toBe('2026-12-09T09:00:00.000Z')
  })

  it('存在しない日付は締切を作らない', () => {
    expect(cancellationRequestDeadline('2026-02-30')).toBeNull()
    expect(cancellationRequestDeadline('20261210')).toBeNull()
  })

  it('締切の直前までは申請でき、締切ちょうどからは電話を案内する', () => {
    expect(cancellationRequestEligibility(reservation(), new Date('2026-12-09T08:59:59.999Z'))).toEqual({ ok: true })
    expect(cancellationRequestEligibility(reservation(), new Date('2026-12-09T09:00:00.000Z')))
      .toEqual({ ok: false, reason: 'past_deadline' })
  })
})

describe('Issue #97 申請できる予約', () => {
  const now = new Date('2026-12-01T00:00:00.000Z')

  it.each(['STS-01', 'STS-02', 'STS-03', 'pending', 'confirmed'])('受付・確認中・確定（%s）は申請できる', (status) => {
    expect(cancellationRequestEligibility(reservation({ status }), now)).toEqual({ ok: true })
  })

  it.each([
    ['STS-04', 'already_cancelled'],
    ['cancelled', 'already_cancelled'],
    ['STS-05', 'not_cancellable'],
    ['STS-06', 'not_cancellable'],
  ])('%s は申請できない', (status, reason) => {
    expect(cancellationRequestEligibility(reservation({ status }), now)).toEqual({ ok: false, reason })
  })

  it('申請中・却下済みは新しい申請を作らない', () => {
    expect(cancellationRequestEligibility(reservation({ cancellationRequestStatus: 'pending' }), now))
      .toEqual({ ok: false, reason: 'already_requested' })
    expect(cancellationRequestEligibility(reservation({ cancellationRequestStatus: 'rejected' }), now))
      .toEqual({ ok: false, reason: 'rejected' })
  })

  it('申請中でもキャンセル済みなら対応待ちに数えない', () => {
    expect(hasPendingCancellationRequest(reservation({ cancellationRequestStatus: 'pending' }))).toBe(true)
    expect(hasPendingCancellationRequest(reservation({ cancellationRequestStatus: 'pending', status: 'STS-04' }))).toBe(false)
  })

  it('予約一覧の「キャンセル申請」に対応待ちだけを出す', () => {
    expect(reservationMatchesCategory(reservation({ cancellationRequestStatus: 'pending' }), 'cancelRequest')).toBe(true)
    expect(reservationMatchesCategory(reservation({ cancellationRequestStatus: 'rejected' }), 'cancelRequest')).toBe(false)
    expect(reservationMatchesCategory(reservation({ cancellationRequestStatus: 'approved', status: 'STS-04' }), 'cancelRequest')).toBe(false)
    expect(reservationMatchesCategory(reservation(), 'cancelRequest')).toBe(false)
  })
})

describe('Issue #97 申請理由', () => {
  it('未入力は空、前後の空白は除く', () => {
    expect(normalizeCancellationRequestNote(undefined)).toBe('')
    expect(normalizeCancellationRequestNote('  体調不良  ')).toBe('体調不良')
  })

  it('長すぎる値・文字列以外・制御文字は受け付けない', () => {
    expect(normalizeCancellationRequestNote('あ'.repeat(201))).toBeNull()
    expect(normalizeCancellationRequestNote(123)).toBeNull()
    expect(normalizeCancellationRequestNote('a\u0000b')).toBeNull()
    expect(normalizeCancellationRequestNote('一行目\n二行目')).toBe('一行目\n二行目')
  })

  it('スタッフの理由を優先し、なければ申請内容を残す', () => {
    expect(cancellationReasonFromRequest({ cancellationRequestNote: '体調不良' }, '日程変更')).toBe('日程変更')
    expect(cancellationReasonFromRequest({ cancellationRequestNote: '体調不良' })).toBe('お客様からのキャンセル申請（体調不良）')
    expect(cancellationReasonFromRequest({})).toBe('お客様からのキャンセル申請')
  })
})

describe('Issue #97 公開画面に返す内容', () => {
  it('氏名・電話番号・スタッフメモ・内部ステータスIDを含めない', () => {
    const view = publicCancellationView(reservation(), new Date('2026-12-01T00:00:00.000Z'))
    const text = JSON.stringify(view)
    expect(text).not.toContain('山田')
    expect(text).not.toContain('090-1234-5678')
    expect(text).not.toContain('送迎あり')
    expect(text).not.toContain('STS-')
    expect(view).toMatchObject({ canRequest: true, request: null, reservation: { state: 'confirmed' } })
  })

  it('申請できない理由とお客様向けの案内を返す', () => {
    const view = publicCancellationView(reservation(), new Date('2026-12-09T10:00:00.000Z'))
    expect(view).toMatchObject({ canRequest: false, blockReason: 'past_deadline' })
    expect(view.message).toContain('お電話')
  })
})

describe('Issue #97 保存形式', () => {
  it('申請の項目をシートの列として持ち、不正な状態は読み捨てる', () => {
    expect(HEADERS.RESERVATIONS).toEqual(expect.arrayContaining([
      'cancellationRequestStatus', 'cancellationRequestedAt', 'cancellationRequestNote', 'cancellationRequestResolvedAt',
    ]))
    expect(new Set(HEADERS.RESERVATIONS).size).toBe(HEADERS.RESERVATIONS.length)
    const row = { id: 'R-1', diveDate: '2026-12-10', guestName: '山田', guestPhone: '090', guestCount: '1', channel: 'hp', status: 'STS-03' }
    expect(normalizeReservation({
      ...row,
      cancellationRequestStatus: 'pending',
      cancellationRequestedAt: '2026-12-01T00:00:00.000Z',
      cancellationRequestNote: '体調不良',
    })).toMatchObject({
      cancellationRequestStatus: 'pending',
      cancellationRequestedAt: '2026-12-01T00:00:00.000Z',
      cancellationRequestNote: '体調不良',
    })
    expect(normalizeReservation({ ...row, cancellationRequestStatus: 'unknown' }).cancellationRequestStatus).toBeUndefined()
  })
})
