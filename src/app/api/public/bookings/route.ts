import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { normalizeReservationInput } from '@/lib/reservationNormalization'
import { ISSUE_5_RESERVATION_STATUS } from '@/lib/reservationStatus'
import type { ReservationInput, ReservationTimeSlot } from '@/types'

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

/**
 * POST /api/public/bookings — 客側予約申し込み（ログイン不要）
 * 「仮押さえ（pending）の新規作成」のみ許可。
 * id / status / channel はサーバー側で強制し、閲覧・更新は一切できない。
 */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const diveDate = firstString([values.diveDate, values.date])
    const exactTime = firstString([values.time])
    const courseName = firstString([values.courseName, values.course])
    const guestName = firstString([values.guestName], true)
    const guestCount = Number(values.guestCount)
    const guestPhone = firstString([values.guestPhone, values.phone], true)
    const guestEmail = firstString([values.guestEmail], true)
    const staffNote = firstString([values.staffNote, values.notes])
    const courseId = typeof values.courseId === 'string' ? values.courseId.trim() : ''
    const timeSlot = values.timeSlot === undefined ? 'unspecified' : values.timeSlot

    if (!isDate(diveDate))
      return NextResponse.json({ error: '日付が不正です' }, { status: 400 })
    if (diveDate < new Date().toISOString().slice(0, 10))
      return NextResponse.json({ error: '過去の日付は指定できません' }, { status: 400 })
    if (exactTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exactTime))
      return NextResponse.json({ error: '時間が不正です' }, { status: 400 })
    if (!courseName.trim() || courseName.length > 200 || !guestName || guestName.length > 50 || !guestPhone || guestPhone.length > 20)
      return NextResponse.json({ error: '必須項目が未入力です' }, { status: 400 })
    if (typeof timeSlot !== 'string' || !TIME_SLOTS.includes(timeSlot as ReservationTimeSlot))
      return NextResponse.json({ error: '時間帯が不正です' }, { status: 400 })
    if (staffNote.length > 500 || guestEmail.length > 254 || (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)))
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20)
      return NextResponse.json({ error: '人数は1〜20名で指定してください' }, { status: 400 })

    const input: ReservationInput = {
      id: `R${Date.now()}`,
      diveDate,
      time: exactTime || undefined,
      timeSlot: timeSlot as ReservationTimeSlot,
      ...(courseId ? { courseId } : {}),
      courseName,
      guestName,
      guestPhone,
      ...(guestEmail ? { guestEmail } : {}),
      guestCount,
      channel: 'hp',
      status: ISSUE_5_RESERVATION_STATUS.requested, // スタッフ承認制：確定は店側画面で行う
      staffNote,
    }
    // Older clients' date/course/phone/notes keys were normalized above; pass
    // the canonical reservation through the same storage boundary as staff input.
    const reservation = normalizeReservationInput(input)
    const savedReservation = await store.addReservation(reservation)
    // 完了画面で問診票URLを作るため、認証トークンと有効期限を返す。
    return NextResponse.json({
      ok: true,
      id: savedReservation.id,
      questionnaireToken: savedReservation.questionnaireToken,
      questionnaireTokenExpiresAt: savedReservation.questionnaireTokenExpiresAt,
    })
  } catch (err) {
    console.error('[POST /api/public/bookings]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
