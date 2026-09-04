/**
 * 予約（Reservations）のデータアクセス層（サーバーサイド専用）
 * ID採番・コース名/スタッフ名の転記（Sheets の VLOOKUP 相当）・タイムスタンプ更新など、
 * store（Sheets / ローカルJSON）に依存しない業務ロジックをここに集約する。
 * API Route からのみ呼び出すこと。
 */
import { store } from './dataStore'
import { getCourseName, getStaffName, DEFAULT_STATUS_ID } from './masters'
import { assertValidNewReservationInput, type NewReservationInput } from './reservationValidation'
import type { Reservation } from '@/types'

export type { NewReservationInput } from './reservationValidation'

/** 予約ID採番: "R-" + YYYYMMDD + 連番3桁（例: R-20260615-001） */
export async function generateReservationId(diveDate: string): Promise<string> {
  const ymd = diveDate.replace(/-/g, '')
  const prefix = `R-${ymd}-`
  const all = await store.getReservations()
  const maxSequence = all.reduce((max, reservation) => {
    const match = reservation.id.match(new RegExp(`^${prefix}(\\d+)$`))
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)
  return `${prefix}${String(maxSequence + 1).padStart(3, '0')}`
}

export async function createReservation(input: NewReservationInput): Promise<Reservation> {
  const validated = assertValidNewReservationInput(input)
  const now = new Date().toISOString()
  const reservation: Reservation = {
    id: await generateReservationId(validated.diveDate),
    createdAt: now,
    updatedAt: now,
    customerId: validated.customerId,
    guestName: validated.guestName,
    guestPhone: validated.guestPhone,
    guestEmail: validated.guestEmail,
    diveDate: validated.diveDate,
    timeSlot: validated.timeSlot,
    courseId: validated.courseId,
    courseName: getCourseName(validated.courseId),
    guestCount: validated.guestCount,
    status: validated.status ?? DEFAULT_STATUS_ID,
    staffId: validated.staffId,
    staffName: getStaffName(validated.staffId),
    channel: validated.channel,
    questionnaireCompleted: false,
    divePoint: validated.divePoint,
    staffNote: validated.staffNote,
  }
  await store.addReservation(reservation)
  return reservation
}

/** 予約更新。最終更新日時を自動更新し、courseId/staffId 変更時は表示用の名称も転記し直す。 */
export async function patchReservation(id: string, delta: Partial<Reservation>): Promise<void> {
  const patch: Partial<Reservation> = { ...delta, updatedAt: new Date().toISOString() }
  if (Object.prototype.hasOwnProperty.call(delta, 'courseId')) {
    patch.courseName = typeof delta.courseId === 'string' ? getCourseName(delta.courseId) : ''
  }
  if (Object.prototype.hasOwnProperty.call(delta, 'staffId')) {
    patch.staffName = getStaffName(delta.staffId)
  }
  await store.updateReservation(id, patch)
}
