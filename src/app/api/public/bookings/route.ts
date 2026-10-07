import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { DEFAULT_STATUS_ID } from '@/lib/masters'
import { MSG } from '@/lib/messages'
import { createReservation, generateReservationId } from '@/lib/reservations'
import { RateLimitedError } from '@/lib/withRetry'
import {
  validateNewReservationInput,
  ReservationValidationError,
} from '@/lib/reservationValidation'
import { normalizeReservationInput } from '@/lib/reservationNormalization'
import { generateQuestionnaireToken, getQuestionnaireExpiry } from '@/lib/questionnaireToken'
import { StoreBusyError, withStoreWriteLock } from '@/lib/storeLock'
import type { ReservationInput, ReservationTimeSlot } from '@/types'

export const runtime = 'nodejs'

const TIME_SLOTS: ReservationTimeSlot[] = ['morning', 'afternoon', 'full', 'unspecified']

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function firstString(values: unknown[], trim = false): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return trim ? value.trim() : value
  }
  return ''
}

/** POST /api/public/bookings — public booking request; old date/course aliases remain accepted. */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const diveDate = firstString([values.diveDate, values.date], true)
    const exactTime = firstString([values.time], true)
    const courseName = firstString([values.courseName, values.course], true)
    const guestName = firstString([values.guestName], true)
    const guestPhone = firstString([values.guestPhone, values.phone], true)
    const guestEmail = firstString([values.guestEmail], true)
    const staffNote = firstString([values.staffNote, values.notes])
    const courseId = firstString([values.courseId], true)
    const guestCount = Number(values.guestCount)
    const timeSlot = values.timeSlot === undefined || values.timeSlot === null || values.timeSlot === ''
      ? 'unspecified'
      : values.timeSlot

    const isNewForm = Boolean(courseId && guestEmail)
    const validated = isNewForm
      ? validateNewReservationInput({
          ...values,
          diveDate,
          guestName,
          guestPhone,
          guestEmail,
          courseId,
          guestCount,
          timeSlot,
          channel: 'hp',
          status: DEFAULT_STATUS_ID,
        }, { allowOta: false, allowPastDate: false })
      : undefined

    if (validated && !validated.ok) {
      return NextResponse.json({
        error: 'VALIDATION_ERROR',
        message: validated.message,
        fields: validated.fields,
      }, { status: 400 })
    }

    if (validated?.ok) {
      const reservation = await createReservation({
        ...validated.data,
        channel: 'hp',
        status: DEFAULT_STATUS_ID,
      })
      return NextResponse.json({
        ok: true,
        id: reservation.id,
        questionnaireToken: reservation.questionnaireToken,
        questionnaireTokenExpiresAt: reservation.questionnaireTokenExpiresAt,
      })
    }

    if (!isDate(diveDate))
      return NextResponse.json({ error: '日付が不正です' }, { status: 400 })
    if (diveDate < new Date().toISOString().slice(0, 10))
      return NextResponse.json({ error: '過去の日付は指定できません' }, { status: 400 })
    if (exactTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exactTime))
      return NextResponse.json({ error: '時間が不正です' }, { status: 400 })
    if (!courseName)
      return NextResponse.json({ error: 'コースを選択してください' }, { status: 400 })
    if (!guestName || guestName.length > 50 || !guestPhone || guestPhone.length > 20)
      return NextResponse.json({ error: '必須項目が未入力です' }, { status: 400 })
    if (typeof timeSlot !== 'string' || !TIME_SLOTS.includes(timeSlot as ReservationTimeSlot))
      return NextResponse.json({ error: '時間帯が不正です' }, { status: 400 })
    if (staffNote.length > 500 || guestEmail.length > 254 || (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)))
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20)
      return NextResponse.json({ error: '人数は1〜20名で指定してください' }, { status: 400 })

    const now = new Date().toISOString()
    const input: ReservationInput = {
      id: await generateReservationId(diveDate),
      createdAt: now,
      updatedAt: now,
      diveDate,
      ...(exactTime ? { time: exactTime, legacyTime: exactTime } : {}),
      timeSlot: timeSlot as ReservationTimeSlot,
      ...(courseId ? { courseId } : {}),
      courseName,
      guestName,
      guestPhone,
      ...(guestEmail ? { guestEmail } : {}),
      guestCount,
      channel: 'hp',
      status: DEFAULT_STATUS_ID,
      questionnaireCompleted: false,
      questionnaireToken: generateQuestionnaireToken(),
      questionnaireTokenExpiresAt: getQuestionnaireExpiry(diveDate),
      staffNote,
    }
    const reservation = normalizeReservationInput(input)
    const saved = await withStoreWriteLock(() => store.addReservation(reservation))
    return NextResponse.json({
      ok: true,
      id: saved.id,
      questionnaireToken: saved.questionnaireToken,
      questionnaireTokenExpiresAt: saved.questionnaireTokenExpiresAt,
    })
  } catch (err) {
    if (err instanceof ReservationValidationError) {
      return NextResponse.json({
        error: 'VALIDATION_ERROR',
        message: err.message,
        fields: err.fields,
      }, { status: 400 })
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503 })
    }
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: '保存処理中です。時間をおいて再度お試しください。' }, { status: 503 })
    }
    console.error('[POST /api/public/bookings]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
