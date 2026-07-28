import { NextRequest, NextResponse } from 'next/server'
import { createReservation } from '@/lib/reservations'
import { COURSES, DEFAULT_STATUS_ID } from '@/lib/masters'
import type { Reservation } from '@/types'

const TIME_SLOTS: Reservation['timeSlot'][] = ['morning', 'afternoon', 'full', 'unspecified']

/**
 * POST /api/public/bookings — 客側予約申し込み（ログイン不要）
 * 「予約受付（仮押さえ）の新規作成」のみ許可。
 * id / status / channel はサーバー側で強制し、閲覧・更新は一切できない。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const diveDate = String(body.diveDate ?? '')
    const timeSlot = TIME_SLOTS.includes(body.timeSlot) ? body.timeSlot : 'unspecified'
    const courseId = String(body.courseId ?? '')
    const guestName = String(body.guestName ?? '').trim().slice(0, 50)
    const guestCount = Number(body.guestCount)
    const guestPhone = String(body.guestPhone ?? '').trim().slice(0, 20)
    const guestEmail = String(body.guestEmail ?? '').trim().slice(0, 100)
    const staffNote = String(body.staffNote ?? '').slice(0, 500)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(diveDate))
      return NextResponse.json({ error: '日付が不正です' }, { status: 400 })
    if (diveDate < new Date().toISOString().slice(0, 10))
      return NextResponse.json({ error: '過去の日付は指定できません' }, { status: 400 })
    if (!COURSES.some((c) => c.id === courseId))
      return NextResponse.json({ error: 'コースが不正です' }, { status: 400 })
    if (!guestName || !guestPhone || !guestEmail)
      return NextResponse.json({ error: '必須項目が未入力です' }, { status: 400 })
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20)
      return NextResponse.json({ error: '人数は1〜20名で指定してください' }, { status: 400 })

    const reservation = await createReservation({
      guestName,
      guestPhone,
      guestEmail,
      diveDate,
      timeSlot,
      courseId,
      guestCount,
      channel: 'hp',
      status: DEFAULT_STATUS_ID, // スタッフ承認制：確定は店側画面で行う
      staffNote,
    })
    // 完了画面でQR生成・予約番号表示に使うため id を返す
    return NextResponse.json({ ok: true, id: reservation.id })
  } catch (err) {
    console.error('[POST /api/public/bookings]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
