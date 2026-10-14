import type { QuestionnaireReservationLink, Reservation } from '@/types'
import { CANCELLED_STATUS_ID, getStatusName } from './masters'

/** 顧客詳細に表示するダイブ履歴1件分 */
export interface DiveHistoryItem {
  reservationId: string
  date: string
  courseName: string
  divePoint: string
  statusName: string
  cancelled: boolean
}

/**
 * 予約の顧客IDと問診票の顧客・予約リンクを統合して、
 * 顧客のダイブ履歴を日付の新しい順に返す。
 * キャンセルも履歴として残し、画面側で区別して表示する。
 */
export function buildDiveHistory(
  customerId: string,
  reservations: Reservation[],
  questionnaires: QuestionnaireReservationLink[] = [],
): DiveHistoryItem[] {
  if (!customerId) return []
  const linkedReservationIds = new Set(
    questionnaires
      .filter((questionnaire) => questionnaire.customerId === customerId)
      .map((questionnaire) => questionnaire.reservationId),
  )
  const matchingReservations = new Map<string, Reservation>()
  for (const reservation of reservations) {
    if (reservation.customerId === customerId || linkedReservationIds.has(reservation.id)) {
      matchingReservations.set(reservation.id, reservation)
    }
  }
  return Array.from(matchingReservations.values())
    .map((r) => ({
      reservationId: r.id,
      date: r.diveDate,
      courseName: r.courseName,
      divePoint: r.divePoint ?? '',
      statusName: getStatusName(r.status),
      cancelled: r.status === CANCELLED_STATUS_ID,
    }))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.reservationId.localeCompare(a.reservationId)
    )
}
