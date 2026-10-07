import type { Reservation } from '@/types'
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
 * 問診票の送信で顧客に紐づいた予約（reservation.customerId）を、
 * その顧客のダイブ履歴として日付の新しい順に返す。
 * キャンセルも履歴として残し、画面側で区別して表示する。
 */
export function buildDiveHistory(
  customerId: string,
  reservations: Reservation[]
): DiveHistoryItem[] {
  if (!customerId) return []
  return reservations
    .filter((r) => r.customerId === customerId)
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
