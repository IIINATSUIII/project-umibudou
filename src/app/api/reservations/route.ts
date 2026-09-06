import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { createReservation, patchReservation, type NewReservationInput } from '@/lib/reservations'
import { CONFIRMED_STATUS_ID } from '@/lib/masters'
import { validateReservationInput } from '@/lib/reservationValidation'
import { withRetry, RateLimitedError } from '@/lib/withRetry'

const MSG_17 = '通信が集中しています。しばらく経ってから再度お試しください。'
const MSG_20 = '他のスタッフが先に更新した可能性があります。最新の内容をご確認ください。'

/** GET /api/reservations — 予約一覧取得（?date=YYYY-MM-DD で当日分に絞り込み） */
export async function GET(req: NextRequest) {
  try {
    const all = await withRetry(() => store.getReservations())
    const date = req.nextUrl.searchParams.get('date')
    const result = date ? all.filter((r) => r.diveDate === date) : all
    return NextResponse.json(result)
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG_17 }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}

/** POST /api/reservations — 予約追加（スタッフによる手動登録。ID採番・コース名転記はサーバー側で行う） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<NewReservationInput>

    const errors = validateReservationInput(body)
    if (errors.length > 0) {
      return NextResponse.json({ error: '入力内容を確認してください', details: errors }, { status: 400 })
    }

    const reservation = await withRetry(() => createReservation({
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
    }))
    return NextResponse.json({ ok: true, id: reservation.id })
  } catch (err) {
    console.error('[POST /api/reservations]', err)
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG_17 }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to add reservation' }, { status: 500 })
  }
}

/**
 * PATCH /api/reservations — 予約更新（id・deltaに加え、任意でexpectedUpdatedAtを渡す）
 * expectedUpdatedAtを渡した場合のみ排他制御（後勝ち検知）を行う。
 * 読み込み時点のupdatedAtと現在値が食い違っていれば409＋MSG-20を返し、書き込みは行わない。
 */
export async function PATCH(req: NextRequest) {
  try {
    const { id, expectedUpdatedAt, ...delta } = await req.json()

    if (expectedUpdatedAt) {
      const all = await withRetry(() => store.getReservations())
      const current = all.find((r) => r.id === id)
      if (current && current.updatedAt !== expectedUpdatedAt) {
        return NextResponse.json({ error: MSG_20, conflict: true }, { status: 409 })
      }
    }

    await withRetry(() => patchReservation(id, delta))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/reservations]', err)
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG_17 }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
}
