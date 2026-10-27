import type { Reservation, ReservationCancellationPhase } from '@/types'

export const ISSUE_5_RESERVATION_STATUS = {
  requested: 'STS-01',
  reviewing: 'STS-02',
  confirmed: 'STS-03',
  cancelled: 'STS-04',
  completed: 'STS-05',
  refunded: 'STS-06',
} as const

const ISSUE_5_STATUS_LABELS: Record<string, string> = {
  [ISSUE_5_RESERVATION_STATUS.requested]: '受付',
  [ISSUE_5_RESERVATION_STATUS.reviewing]: '確認中',
  [ISSUE_5_RESERVATION_STATUS.confirmed]: '確定',
  [ISSUE_5_RESERVATION_STATUS.cancelled]: 'キャンセル',
  [ISSUE_5_RESERVATION_STATUS.completed]: '実施済',
  [ISSUE_5_RESERVATION_STATUS.refunded]: '返金済',
}

export function reservationStatusLabel(status: string): string {
  return ISSUE_5_STATUS_LABELS[status] ?? ({
    pending: '仮押さえ',
    confirmed: '確定',
    cancelled: 'キャンセル',
    canceled: 'キャンセル',
  } as Record<string, string>)[status] ?? status
}

export function reservationStatusStyle(status: string): string {
  if (status === 'pending' || status === ISSUE_5_RESERVATION_STATUS.requested || status === ISSUE_5_RESERVATION_STATUS.reviewing) {
    return 'bg-yellow-100 text-yellow-700'
  }
  if (status === 'confirmed' || status === ISSUE_5_RESERVATION_STATUS.confirmed) {
    return 'bg-green-100 text-green-700'
  }
  if (isCancelledReservationStatus(status)) {
    return 'bg-red-100 text-red-700'
  }
  if (status === ISSUE_5_RESERVATION_STATUS.completed) return 'bg-gray-200 text-gray-700'
  if (status === ISSUE_5_RESERVATION_STATUS.refunded) return 'bg-blue-100 text-blue-700'
  return 'bg-gray-100 text-gray-600'
}

export function isPendingReservationStatus(status: string): boolean {
  return status === 'pending' ||
    status === ISSUE_5_RESERVATION_STATUS.requested ||
    status === ISSUE_5_RESERVATION_STATUS.reviewing
}

export function isConfirmedReservationStatus(status: string): boolean {
  return status === 'confirmed' || status === ISSUE_5_RESERVATION_STATUS.confirmed
}

export function isCancelledReservationStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return normalized === ISSUE_5_RESERVATION_STATUS.cancelled.toLowerCase() || /^cancel(?:l?ed)?(?:$|[\s_-])/.test(normalized)
}

export function isQuestionnaireReservationAllowed(status: string): boolean {
  return !isCancelledReservationStatus(status) &&
    status.trim().toUpperCase() !== ISSUE_5_RESERVATION_STATUS.refunded
}

export function isCancellableReservationStatus(status: string): boolean {
  return isPendingReservationStatus(status) || isConfirmedReservationStatus(status)
}

export function confirmedReservationStatus(current: Reservation): string {
  return /^STS-\d{2}$/.test(current.status)
    ? ISSUE_5_RESERVATION_STATUS.confirmed
    : 'confirmed'
}

export function cancelledReservationStatus(current: Reservation): string {
  return /^STS-\d{2}$/.test(current.status)
    ? ISSUE_5_RESERVATION_STATUS.cancelled
    : 'cancelled'
}

export type ReservationCategory = 'all' | 'confirmed' | 'progress' | 'before' | 'after'

/** Determine the cancellation phase from the status immediately before cancellation. */
export function cancellationPhaseForStatus(status: string): ReservationCancellationPhase | null {
  if (isConfirmedReservationStatus(status)) return 'after'
  if (isPendingReservationStatus(status)) return 'before'
  return null
}

/** Return the persisted phase, without guessing for legacy cancelled records. */
export function cancellationPhaseFor(reservation: Reservation): ReservationCancellationPhase | null {
  return reservation.cancellationPhase ?? null
}

export function reservationMatchesCategory(
  reservation: Reservation,
  category: ReservationCategory,
): boolean {
  if (category === 'all') return true
  if (category === 'confirmed') return isConfirmedReservationStatus(reservation.status)
  if (category === 'progress') return isPendingReservationStatus(reservation.status)
  return isCancelledReservationStatus(reservation.status) &&
    cancellationPhaseFor(reservation) === category
}
