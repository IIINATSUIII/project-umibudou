/**
 * お客様からのキャンセル申請（Issue #97）の判定ロジック。
 * 申請は予約ステータスを変えず、スタッフが承認したときにキャンセルが成立する。
 * 仕様は docs/11_キャンセル申請.md を参照。
 */
import type { Reservation } from '@/types'
import {
  isCancellableReservationStatus,
  isCancelledReservationStatus,
  isConfirmedReservationStatus,
  isPendingReservationStatus,
} from './reservationStatus'

/**
 * オンライン申請の締切。ダイブ日の前日のこの時刻（日本時間）を過ぎたら電話で受け付ける。
 * 店舗の運用確認後に調整する。
 */
export const CANCELLATION_REQUEST_CUTOFF_HOUR_JST = 18
export const CANCELLATION_REQUEST_NOTE_MAX_LENGTH = 200

const HOUR_MS = 60 * 60 * 1000

/** オンライン申請の締切日時。ダイブ日が不正なら null。 */
export function cancellationRequestDeadline(diveDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diveDate)) return null
  const diveDayStart = Date.parse(`${diveDate}T00:00:00+09:00`)
  if (!Number.isFinite(diveDayStart)) return null
  // 2026-02-30 などは Date.parse が繰り上げるため、日付が変わらないことを確かめる。
  const roundTrip = new Date(diveDayStart + 9 * HOUR_MS).toISOString().slice(0, 10)
  if (roundTrip !== diveDate) return null
  return new Date(diveDayStart - 24 * HOUR_MS + CANCELLATION_REQUEST_CUTOFF_HOUR_JST * HOUR_MS)
}

export type CancellationRequestBlockReason =
  | 'already_requested'
  | 'rejected'
  | 'already_cancelled'
  | 'not_cancellable'
  | 'past_deadline'

export type CancellationRequestEligibility =
  | { ok: true }
  | { ok: false; reason: CancellationRequestBlockReason }

/** お客様がオンラインでキャンセルを申請できるか。 */
export function cancellationRequestEligibility(
  reservation: Pick<Reservation, 'status' | 'diveDate' | 'cancellationRequestStatus'>,
  now: Date,
): CancellationRequestEligibility {
  if (isCancelledReservationStatus(reservation.status)) return { ok: false, reason: 'already_cancelled' }
  if (!isCancellableReservationStatus(reservation.status)) return { ok: false, reason: 'not_cancellable' }
  if (reservation.cancellationRequestStatus === 'pending') return { ok: false, reason: 'already_requested' }
  if (reservation.cancellationRequestStatus === 'rejected') return { ok: false, reason: 'rejected' }
  const deadline = cancellationRequestDeadline(reservation.diveDate)
  if (!deadline || now.getTime() >= deadline.getTime()) return { ok: false, reason: 'past_deadline' }
  return { ok: true }
}

/** スタッフの対応待ちになっている申請か。 */
export function hasPendingCancellationRequest(
  reservation: Pick<Reservation, 'status' | 'cancellationRequestStatus'>,
): boolean {
  return reservation.cancellationRequestStatus === 'pending' &&
    isCancellableReservationStatus(reservation.status)
}

/** 申請理由を検証する。未入力は空文字、不正な値は null。 */
export function normalizeCancellationRequestNote(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  const note = value.trim()
  if (note.length > CANCELLATION_REQUEST_NOTE_MAX_LENGTH) return null
  // 改行以外の制御文字はスタッフ画面の表示を崩すため受け付けない。
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(note)) return null
  return note
}

export const CANCELLATION_REQUEST_MESSAGES: Record<CancellationRequestBlockReason, string> = {
  already_requested: 'キャンセル申請はすでに受け付けています。ショップからの連絡をお待ちください。',
  rejected: 'この予約のキャンセルはWebでは受け付けられません。お手数ですがショップへお電話ください。',
  already_cancelled: 'この予約はすでにキャンセルされています。',
  not_cancellable: 'この予約はWebからキャンセルを申請できません。ショップへお電話ください。',
  past_deadline: 'Webでの申請期限を過ぎています。お手数ですがショップへお電話ください。',
}

export type PublicCancellationView = {
  reservation: {
    diveDate: string
    time?: string
    timeSlot: Reservation['timeSlot']
    courseName: string
    guestCount: number
    /** 予約の進み具合だけを返し、内部のステータスIDは返さない。 */
    state: 'requested' | 'confirmed' | 'cancelled' | 'closed'
  }
  request: { status: NonNullable<Reservation['cancellationRequestStatus']>; requestedAt?: string } | null
  deadline: string | null
  canRequest: boolean
  blockReason?: CancellationRequestBlockReason
  message?: string
}

/** 公開画面に返す予約の概要。氏名・電話番号・スタッフメモなどは含めない。 */
export function publicCancellationView(reservation: Reservation, now: Date): PublicCancellationView {
  const eligibility = cancellationRequestEligibility(reservation, now)
  const deadline = cancellationRequestDeadline(reservation.diveDate)
  const state: PublicCancellationView['reservation']['state'] = isCancelledReservationStatus(reservation.status)
    ? 'cancelled'
    : isConfirmedReservationStatus(reservation.status)
      ? 'confirmed'
      : isPendingReservationStatus(reservation.status)
        ? 'requested'
        : 'closed'
  return {
    reservation: {
      diveDate: reservation.diveDate,
      ...(reservation.time ? { time: reservation.time } : {}),
      timeSlot: reservation.timeSlot,
      courseName: reservation.courseName,
      guestCount: reservation.guestCount,
      state,
    },
    request: reservation.cancellationRequestStatus
      ? {
          status: reservation.cancellationRequestStatus,
          ...(reservation.cancellationRequestedAt ? { requestedAt: reservation.cancellationRequestedAt } : {}),
        }
      : null,
    deadline: deadline ? deadline.toISOString() : null,
    canRequest: eligibility.ok,
    ...(eligibility.ok ? {} : {
      blockReason: eligibility.reason,
      message: CANCELLATION_REQUEST_MESSAGES[eligibility.reason],
    }),
  }
}

/** スタッフがキャンセルを確定したときの理由。スタッフの入力がなければ申請内容を残す。 */
export function cancellationReasonFromRequest(
  reservation: Pick<Reservation, 'cancellationRequestNote'>,
  staffReason?: string,
): string {
  if (staffReason?.trim()) return staffReason.trim()
  const note = reservation.cancellationRequestNote?.trim()
  return note ? `お客様からのキャンセル申請（${note}）` : 'お客様からのキャンセル申請'
}

/** 申請画面へのリンク（予約番号と確認コードを含める。/line-menu 配下なのでログイン不要）。 */
export function buildCancellationRequestPath(reservationId: string, reservationToken: string): string {
  const params = new URLSearchParams({ reservationId, token: reservationToken })
  return `/line-menu/cancel?${params.toString()}`
}
