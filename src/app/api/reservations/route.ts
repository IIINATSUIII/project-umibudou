import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { importGoogleFormBookings } from '@/lib/googleFormImport'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import {
  createReservation,
  generateReservationId,
  patchReservation,
  ReservationConflictError,
} from '@/lib/reservations'
import { MSG } from '@/lib/messages'
import { CONFIRMED_STATUS_ID, STATUSES } from '@/lib/masters'
import {
  validateNewReservationInput,
  ReservationValidationError,
} from '@/lib/reservationValidation'
import { normalizeReservationInput, normalizeReservationPatch } from '@/lib/reservationNormalization'
import {
  cancelledReservationStatus,
  isCancelledReservationStatus,
  isCancellableReservationStatus,
} from '@/lib/reservationStatus'
import {
  deriveReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from '@/lib/reservationQuestionnaireToken'
import { generateQuestionnaireToken, getQuestionnaireExpiry } from '@/lib/questionnaireToken'
import { withRetry, RateLimitedError } from '@/lib/withRetry'
import { StoreBusyError, withStoreWriteLock } from '@/lib/storeLock'
import type { ReservationInput, ReservationTimeSlot } from '@/types'

async function isStaff(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return Boolean(token && await verifySessionToken(token))
}

/** GET /api/reservations — 予約一覧取得 */
export async function GET(req: NextRequest) {
  if (!await isStaff(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await importGoogleFormBookings()
    if (result.errors.length) console.warn('[GET /api/reservations] Googleフォーム取込:', result.errors)
    const reservations = await withRetry(() => store.getReservations())
    for (const reservation of reservations) {
      const token = reservation.questionnaireToken?.trim() || deriveReservationQuestionnaireToken(reservation.id)
      const expiry = reservation.questionnaireTokenExpiresAt?.trim() || questionnaireTokenExpiryForDiveDate(reservation.diveDate)
      if (token !== reservation.questionnaireToken || expiry !== reservation.questionnaireTokenExpiresAt) {
        await store.updateReservation(reservation.id, {
          questionnaireToken: token,
          questionnaireTokenExpiresAt: expiry,
        })
        reservation.questionnaireToken = token
        reservation.questionnaireTokenExpiresAt = expiry
      }
    }
    const date = req.nextUrl.searchParams.get('date')
    return NextResponse.json(date ? reservations.filter((r) => r.diveDate === date) : reservations)
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    if (err instanceof RateLimitedError)
      return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503 })
    return NextResponse.json(
      { error: 'Failed to fetch reservations' },
      { status: 500 }
    )
  }
}

/** POST /api/reservations — staff reservation creation */
export async function POST(req: NextRequest) {
  if (!await isStaff(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const hasExactLegacyTime = typeof values.time === 'string' && values.time.trim() !== ''
    const isNewForm = typeof values.courseId === 'string' && typeof values.guestEmail === 'string' && !hasExactLegacyTime
    if (isNewForm) {
      const validation = validateNewReservationInput(body, { allowOta: false })
      if (!validation.ok) {
        return NextResponse.json({
          error: 'VALIDATION_ERROR',
          message: validation.message,
          fields: validation.fields,
        }, { status: 400 })
      }
      const reservation = await createReservation({
        ...validation.data,
        status: validation.data.status ?? CONFIRMED_STATUS_ID,
      })
      return NextResponse.json({ ok: true, id: reservation.id })
    }

    // Issue #5 and older clients may send date/course/phone/notes and an exact HH:MM.
    const diveDate = typeof values.diveDate === 'string' ? values.diveDate : values.date
    const courseName = typeof values.courseName === 'string' ? values.courseName : values.course
    const guestPhone = typeof values.guestPhone === 'string' ? values.guestPhone : values.phone
    const staffNote = typeof values.staffNote === 'string' ? values.staffNote : values.notes
    const guestName = typeof values.guestName === 'string' ? values.guestName.trim() : ''
    const slot = values.timeSlot ?? 'unspecified'
    const guestCount = Number(values.guestCount)
    const guestEmail = typeof values.guestEmail === 'string' ? values.guestEmail.trim() : ''
    if (typeof diveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(diveDate) || !Number.isFinite(Date.parse(`${diveDate}T00:00:00Z`))) {
      return NextResponse.json({ error: 'ダイブ日を正しく入力してください' }, { status: 400 })
    }
    if (typeof courseName !== 'string' || !courseName.trim() || courseName.length > 200 || !guestName || guestName.length > 50 || typeof guestPhone !== 'string' || !guestPhone.trim() || guestPhone.length > 20) {
      return NextResponse.json({ error: '必須項目が未入力です' }, { status: 400 })
    }
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20 || !['morning', 'afternoon', 'full', 'unspecified'].includes(String(slot))) {
      return NextResponse.json({ error: '人数または時間帯を確認してください' }, { status: 400 })
    }
    if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
      return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 })
    }
    if (typeof values.time === 'string' && values.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(values.time)) {
      return NextResponse.json({ error: '時間が不正です' }, { status: 400 })
    }
    const now = new Date().toISOString()
    const input: ReservationInput = {
      ...values,
      id: await generateReservationId(diveDate),
      createdAt: now,
      updatedAt: now,
      diveDate,
      courseName: courseName.trim(),
      guestName,
      guestPhone: guestPhone.trim(),
      ...(guestEmail ? { guestEmail } : {}),
      guestCount,
      timeSlot: slot as ReservationTimeSlot,
      channel: typeof values.channel === 'string' ? values.channel as ReservationInput['channel'] : 'hp',
      status: typeof values.status === 'string' ? values.status : CONFIRMED_STATUS_ID,
      questionnaireCompleted: false,
      questionnaireToken: generateQuestionnaireToken(),
      questionnaireTokenExpiresAt: getQuestionnaireExpiry(diveDate),
      ...(typeof values.time === 'string' && values.time ? { time: values.time, legacyTime: values.time } : {}),
      ...(typeof staffNote === 'string' ? { staffNote } : {}),
    }
    const reservation = normalizeReservationInput(input)
    const saved = await withStoreWriteLock(() => store.addReservation(reservation))
    return NextResponse.json({ ok: true, id: saved.id })
  } catch (err) {
    if (err instanceof ReservationValidationError) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: err.message, fields: err.fields }, { status: 400 })
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503 })
    }
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: '保存処理中です。時間をおいて再度お試しください。' }, { status: 503 })
    }
    console.error('[POST /api/reservations]', err)
    return NextResponse.json(
      { error: 'Failed to add reservation' },
      { status: 500 }
    )
  }
}

/** PATCH /api/reservations — conflict-checked update with legacy cancellation support */
export async function PATCH(req: NextRequest) {
  if (!await isStaff(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const id = typeof values.id === 'string' ? values.id.trim() : ''
    const expectedUpdatedAt = typeof values.expectedUpdatedAt === 'string' ? values.expectedUpdatedAt : undefined
    if (!id) return NextResponse.json({ error: '予約IDを指定してください' }, { status: 400 })
    if (!expectedUpdatedAt) return NextResponse.json({ error: '読込時の更新日時が必要です' }, { status: 400 })
    const allowed = ['status', 'staffId', 'staffNote', 'divePoint', 'diveDate', 'date', 'time', 'timeSlot', 'courseId', 'courseName', 'course', 'guestName', 'guestPhone', 'phone', 'guestEmail', 'guestCount', 'notes']
    const rawDelta = Object.fromEntries(Object.entries(values).filter(([key]) => allowed.includes(key)))
    if (!Object.keys(rawDelta).length) {
      return NextResponse.json({ error: '更新項目を指定してください' }, { status: 400 })
    }
    if (Object.entries(rawDelta).some(([key, value]) => key === 'guestCount'
      ? typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20
      : typeof value !== 'string')) {
      return NextResponse.json({ error: '更新値が不正です' }, { status: 400 })
    }
    const delta = normalizeReservationPatch(rawDelta as ReservationInput)
    if (typeof delta.status === 'string') {
      const knownStatus = STATUSES.some((status) => status.id === delta.status)
        || ['pending', 'confirmed', 'cancelled', 'canceled'].includes(delta.status)
      if (!knownStatus) return NextResponse.json({ error: 'ステータスが不正です' }, { status: 400 })
    }
    if (isCancelledReservationStatus(delta.status ?? '')) {
      const current = (await store.getReservations()).find((reservation) => reservation.id === id)
      if (!current) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
      if (!isCancellableReservationStatus(current.status)) {
        return NextResponse.json({ error: 'この予約はキャンセルできません' }, { status: 409 })
      }
      delta.status = cancelledReservationStatus(current)
    }
    const updatedAt = await patchReservation(id, delta, expectedUpdatedAt)
    return NextResponse.json({ ok: true, updatedAt })
  } catch (err) {
    console.error('[PATCH /api/reservations]', err)
    if (err instanceof ReservationConflictError) {
      return NextResponse.json({ error: err.message, conflict: true }, { status: 409 })
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503 })
    }
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: '保存処理中です。時間をおいて再度お試しください。' }, { status: 503 })
    }
    return NextResponse.json(
      { error: 'Failed to update reservation' },
      { status: 500 }
    )
  }
}
