import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { Reservation } from '@/types'

/**
 * POST /api/public/bookings — 客側予約申し込み（ログイン不要）
 * 「仮押さえ（pending）の新規作成」のみ許可。
 * id / status / channel はサーバー側で強制し、閲覧・更新は一切できない。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const date = String(body.date ?? '')
    const time = String(body.time ?? '')
    const course = String(body.course ?? '').slice(0, 50)
    const guestName = String(body.guestName ?? '').trim().slice(0, 50)
    const guestCount = Number(body.guestCount)
    const phone = String(body.phone ?? '').trim().slice(0, 20)
    const notes = String(body.notes ?? '').slice(0, 500)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ error: '日付が不正です' }, { status: 400 })
    if (date < new Date().toISOString().slice(0, 10))
      return NextResponse.json({ error: '過去の日付は指定できません' }, { status: 400 })
    if (!/^\d{2}:\d{2}$/.test(time))
      return NextResponse.json({ error: '時間が不正です' }, { status: 400 })
    if (!course || !guestName || !phone)
      return NextResponse.json({ error: '必須項目が未入力です' }, { status: 400 })
    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20)
      return NextResponse.json({ error: '人数は1〜20名で指定してください' }, { status: 400 })

    const reservation: Reservation = {
      id: `R${Date.now()}`,
      date,
      time,
      course,
      guestName,
      guestCount,
      phone,
      channel: 'hp',
      status: 'pending', // スタッフ承認制：確定は店側画面で行う
      notes,
    }
    await store.addReservation(reservation)
    // 完了画面でQR生成・予約番号表示に使うため id を返す
    return NextResponse.json({ ok: true, id: reservation.id })
  } catch (err) {
    console.error('[POST /api/public/bookings]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
