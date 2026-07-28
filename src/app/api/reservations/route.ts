import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { createReservation, patchReservation, type NewReservationInput } from '@/lib/reservations'
import { CONFIRMED_STATUS_ID } from '@/lib/masters'

/** GET /api/reservations — 予約一覧取得 */
export async function GET() {
  try {
    return NextResponse.json(await store.getReservations())
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}

/** POST /api/reservations — 予約追加（スタッフによる手動登録。ID採番・コース名転記はサーバー側で行う） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<NewReservationInput>
    const reservation = await createReservation({
      guestName: String(body.guestName ?? ''),
      guestPhone: String(body.guestPhone ?? ''),
      guestEmail: String(body.guestEmail ?? ''),
      diveDate: String(body.diveDate ?? ''),
      timeSlot: body.timeSlot ?? 'unspecified',
      courseId: String(body.courseId ?? ''),
      guestCount: Number(body.guestCount) || 1,
      channel: body.channel ?? 'phone',
      status: body.status ?? CONFIRMED_STATUS_ID, // 手動登録は即確定扱い
      staffId: body.staffId,
      divePoint: body.divePoint,
      staffNote: body.staffNote,
    })
    return NextResponse.json({ ok: true, id: reservation.id })
  } catch (err) {
    console.error('[POST /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to add reservation' }, { status: 500 })
  }
}

/** PATCH /api/reservations — 予約更新（idとdeltaをbodyに渡す） */
export async function PATCH(req: NextRequest) {
  try {
    const { id, ...delta } = await req.json()
    await patchReservation(id, delta)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
}
