/**
 * 予約（Reservations）のデータアクセス層（サーバーサイド専用）
 * ID採番・コース名/スタッフ名の転記（Sheets の VLOOKUP 相当）・タイムスタンプ更新など、
 * store（Sheets / ローカルJSON）に依存しない業務ロジックをここに集約する。
 * API Route からのみ呼び出すこと。
 */
import { store } from './dataStore'
import { getCourseName, getStaffName, DEFAULT_STATUS_ID } from './masters'
import {
  assertValidNewReservationInput,
  type NewReservationInput,
} from './reservationValidation'
import type { Reservation, ReservationEmail } from '@/types'
import { nextUpdatedAt } from './updateVersion'
import { randomUUID } from 'crypto'
import { withStoreWriteLock } from './storeLock'
import { DataStoreConflictError } from './dataStoreErrors'
import {
  generateQuestionnaireToken,
  getQuestionnaireExpiry,
} from './questionnaireToken'

export type { NewReservationInput } from './reservationValidation'

export type CreateReservationOptions = {
  /** 公開フォームの受付メールをOutboxへ登録する場合だけtrueにする。 */
  sendReceipt?: boolean
  /** 公開POSTの再送を同じ予約へ収束させるキー。 */
  requestKey?: string
}

export class ReservationIdempotencyConflictError extends Error {
  constructor() {
    super('同じ再送キーに別の予約内容が指定されています')
    this.name = 'ReservationIdempotencyConflictError'
  }
}

function samePublicRequest(
  reservation: Reservation,
  input: NewReservationInput,
): boolean {
  return reservation.guestName === input.guestName &&
    reservation.guestPhone === input.guestPhone &&
    reservation.guestEmail === input.guestEmail &&
    reservation.diveDate === input.diveDate &&
    reservation.timeSlot === input.timeSlot &&
    reservation.courseId === input.courseId &&
    reservation.guestCount === input.guestCount
}

function receiptFromReservation(
  reservation: Reservation,
  requestKey: string,
  now: string,
): ReservationEmail {
  return {
    id: `RE-${reservation.id}`,
    reservationId: reservation.id,
    requestKey,
    recipientEmail: reservation.guestEmail,
    guestName: reservation.guestName,
    diveDate: reservation.diveDate,
    timeSlot: reservation.timeSlot,
    courseId: reservation.courseId ?? '',
    courseName: reservation.courseName,
    guestCount: reservation.guestCount,
    status: 'pending',
    attemptCount: 0,
    availableAt: now,
    createdAt: now,
  }
}

/** 予約IDは全実行環境で一意なUUID。旧連番IDは変更しない。 */
export async function generateReservationId(diveDate: string): Promise<string> {
  return `R-${diveDate.replace(/-/g, '')}-${randomUUID()}`
}

export async function createReservation(
  input: NewReservationInput,
  options: CreateReservationOptions = {},
): Promise<Reservation> {
  const validated = assertValidNewReservationInput(input)
  if (options.sendReceipt && !options.requestKey) {
    throw new Error('公開予約の再送キーがありません')
  }
  return withStoreWriteLock(async () => {
    if (options.sendReceipt && options.requestKey) {
      const existing = (await store.getReservations()).find(
        (reservation) => reservation.publicRequestKey === options.requestKey,
      )
      if (existing) {
        if (!samePublicRequest(existing, validated))
          throw new ReservationIdempotencyConflictError()
        const existingEmail = (await store.getReservationEmails()).find(
          (email) => email.reservationId === existing.id,
        )
        if (!existingEmail)
          await store.addReservationEmail(receiptFromReservation(existing, options.requestKey, new Date().toISOString()))
        return existing
      }
    }

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
      questionnaireToken: generateQuestionnaireToken(),
      questionnaireTokenExpiresAt: getQuestionnaireExpiry(validated.diveDate),
      divePoint: validated.divePoint,
      staffNote: validated.staffNote,
      ...(options.sendReceipt && options.requestKey
        ? { publicRequestKey: options.requestKey }
        : {}),
    }
    await store.addReservation(reservation)
    if (options.sendReceipt && options.requestKey)
      await store.addReservationEmail(receiptFromReservation(reservation, options.requestKey, now))
    return reservation
  })
}

/** 予約更新。最終更新日時を自動更新し、courseId/staffId 変更時は表示用の名称も転記し直す。 */
export class ReservationConflictError extends Error {}
export function hasUpdateConflict(
  current: Pick<Reservation, 'updatedAt'> | undefined,
  expected: string | undefined
): boolean {
  return expected !== undefined && expected !== (current?.updatedAt ?? '')
}
export async function patchReservation(
  id: string,
  delta: Partial<Reservation>,
  expectedUpdatedAt?: string
): Promise<string> {
  return withStoreWriteLock(async () => {
    const current = (await store.getReservations()).find((r) => r.id === id)
    if (!current) throw new Error('Reservation not found')
    if (hasUpdateConflict(current, expectedUpdatedAt))
      throw new ReservationConflictError(
        '他のスタッフが先に更新した可能性があります。最新の内容をご確認ください。'
      )
    const patch: Partial<Reservation> = {
      ...delta,
      updatedAt: nextUpdatedAt(current.updatedAt),
    }
    if (Object.prototype.hasOwnProperty.call(delta, 'courseId')) {
      patch.courseName =
        typeof delta.courseId === 'string' ? getCourseName(delta.courseId) : ''
    }
    if (Object.prototype.hasOwnProperty.call(delta, 'staffId')) {
      patch.staffName = getStaffName(delta.staffId)
    }
    try {
      await store.updateReservation(id, patch, expectedUpdatedAt)
    } catch (error) {
      if (error instanceof DataStoreConflictError) {
        throw new ReservationConflictError(
          '他のスタッフが先に更新した可能性があります。最新の内容をご確認ください。'
        )
      }
      throw error
    }
    return patch.updatedAt!
  })
}
