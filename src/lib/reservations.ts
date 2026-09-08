/**
 * 予約（Reservations）のデータアクセス層（サーバーサイド専用）
 * ID採番・コース名/スタッフ名の転記（Sheets の VLOOKUP 相当）・タイムスタンプ更新など、
 * store（Sheets / ローカルJSON）に依存しない業務ロジックをここに集約する。
 * API Route からのみ呼び出すこと。
 */
import { store } from './dataStore'
import { getCourseName, getStaffName, DEFAULT_STATUS_ID } from './masters'
import type { Reservation } from '@/types'

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

/** 予約ID採番: "R-" + YYYYMMDD + 連番3桁（例: R-20260615-001） */
export async function generateReservationId(diveDate: string): Promise<string> {
  const ymd = diveDate.replace(/-/g, '')
  const prefix = `R-${ymd}-`
  const all = await store.getReservations()
  const seq = all.filter((r) => r.id.startsWith(prefix)).length + 1
  return `${prefix}${pad(seq, 3)}`
}

export type NewReservationInput = {
  guestName: string
  guestPhone: string
  guestEmail: string
  diveDate: string
  timeSlot: Reservation['timeSlot']
  courseId: string
  guestCount: number
  channel: Reservation['channel']
  status?: string
  staffId?: string
  divePoint?: string
  staffNote?: string
  customerId?: string
}

export async function createReservation(input: NewReservationInput): Promise<Reservation> {
  const now = new Date().toISOString()
  const reservation: Reservation = {
    id: await generateReservationId(input.diveDate),
    createdAt: now,
    updatedAt: now,
    customerId: input.customerId,
    guestName: input.guestName,
    guestPhone: input.guestPhone,
    guestEmail: input.guestEmail,
    diveDate: input.diveDate,
    timeSlot: input.timeSlot,
    courseId: input.courseId,
    courseName: getCourseName(input.courseId),
    guestCount: input.guestCount,
    status: input.status ?? DEFAULT_STATUS_ID,
    staffId: input.staffId,
    staffName: getStaffName(input.staffId),
    channel: input.channel,
    questionnaireCompleted: false,
    divePoint: input.divePoint,
    staffNote: input.staffNote,
  }
  await store.addReservation(reservation)
  return reservation
}

/** 後勝ち検知: 読み込み時点のupdatedAtと現在値が食い違っていればtrue（詳細設計書2-5-2, MSG-20） */
export function hasUpdateConflict(
  current: Pick<Reservation, 'updatedAt'> | undefined,
  expectedUpdatedAt: string
): boolean {
  return !!current && current.updatedAt !== expectedUpdatedAt
}

/** 予約更新。最終更新日時を自動更新し、courseId/staffId 変更時は表示用の名称も転記し直す。 */
export async function patchReservation(id: string, delta: Partial<Reservation>): Promise<void> {
  const patch: Partial<Reservation> = { ...delta, updatedAt: new Date().toISOString() }
  if (delta.courseId) patch.courseName = getCourseName(delta.courseId)
  if (delta.staffId) patch.staffName = getStaffName(delta.staffId)
  await store.updateReservation(id, patch)
}
