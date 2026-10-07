import type { Reservation, ReservationInput } from '@/types'
import { ISSUE_5_RESERVATION_STATUS } from './reservationStatus'

/** Convert legacy field names to the canonical Reservation names without discarding source values. */
export function normalizeReservationPatch(input: ReservationInput): Partial<Reservation> {
  const { date, course, phone, notes, ...canonical } = input
  const normalized: Partial<Reservation> = { ...canonical }
  if (canonical.diveDate === undefined && date !== undefined) normalized.diveDate = date
  if (canonical.courseName === undefined && course !== undefined) normalized.courseName = course
  if (canonical.guestPhone === undefined && phone !== undefined) normalized.guestPhone = phone
  if (canonical.staffNote === undefined && notes !== undefined) normalized.staffNote = notes
  return normalized
}

/** Normalize an old API/import row or an Issue #5-shaped row into the app's canonical model. */
export function normalizeReservationInput(input: ReservationInput): Reservation {
  const patch = normalizeReservationPatch(input)
  if (!patch.id) throw new Error('Reservation ID is required')
  if (!patch.diveDate) throw new Error('Reservation diveDate is required')

  return {
    ...patch,
    id: patch.id,
    diveDate: patch.diveDate,
    guestName: patch.guestName ?? '',
    guestPhone: patch.guestPhone ?? '',
    guestCount: patch.guestCount ?? 1,
    timeSlot: patch.timeSlot ?? 'unspecified',
    courseName: patch.courseName ?? '',
    status: patch.status ?? ISSUE_5_RESERVATION_STATUS.requested,
    channel: patch.channel ?? 'hp',
  }
}
