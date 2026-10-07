import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import {
  createReservation,
  patchReservation,
  ReservationConflictError,
} from '@/lib/reservations'
import { importGoogleFormBookings } from '@/lib/googleFormImport'
import { withRetry, RateLimitedError } from '@/lib/withRetry'
import { StoreBusyError } from '@/lib/storeLock'
import { CONFIRMED_STATUS_ID } from '@/lib/masters'
import {
  validateNewReservationInput,
  ReservationValidationError,
  type NewReservationInput,
} from '@/lib/reservationValidation'

/** GET /api/reservations — 予約一覧取得 */
export async function GET(req: NextRequest) {
  try {
    await importGoogleFormBookings()
    const all = await withRetry(() => store.getReservations())
    const date = req.nextUrl.searchParams.get('date')
    return NextResponse.json(
      date ? all.filter((r) => r.diveDate === date) : all
    )
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    return NextResponse.json(
      { error: 'Failed to fetch reservations' },
      { status: 500 }
    )
  }
}

/** POST /api/reservations — 予約追加（スタッフによる手動登録。ID採番・コース名転記はサーバー側で行う） */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown
    const validation = validateNewReservationInput(body, { allowOta: false })
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: validation.message,
          fields: validation.fields,
        },
        { status: 400 }
      )
    }

    const reservation = await createReservation({
      ...validation.data,
      status: validation.data.status ?? CONFIRMED_STATUS_ID, // 手動登録は初期値を確定扱い
    })
    return NextResponse.json({ ok: true, id: reservation.id })
  } catch (err) {
    if (err instanceof ReservationValidationError) {
      return NextResponse.json(
        {
          error: 'VALIDATION_ERROR',
          message: err.message,
          fields: err.fields,
        },
        { status: 400 }
      )
    }
    console.error('[POST /api/reservations]', err)
    return NextResponse.json(
      { error: 'Failed to add reservation' },
      { status: 500 }
    )
  }
}

/** PATCH /api/reservations — 予約更新（idとdeltaをbodyに渡す） */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.id !== 'string'
    )
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 })
    const { id, expectedUpdatedAt, ...values } = body
    const allowed = ['status', 'staffId', 'staffNote', 'divePoint']
    const delta = Object.fromEntries(
      Object.entries(values).filter(([key]) => allowed.includes(key))
    )
    if (Object.values(delta).some((v) => typeof v !== 'string'))
      return NextResponse.json(
        { error: '更新値は文字列で指定してください' },
        { status: 400 }
      )
    if (
      Object.keys(delta).length === 0 ||
      typeof expectedUpdatedAt !== 'string'
    )
      return NextResponse.json(
        { error: '更新項目と読込時の更新日時が必要です' },
        { status: 400 }
      )
    if (
      delta.status !== undefined &&
      !['STS-01', 'STS-02', 'STS-03', 'STS-04', 'STS-05', 'STS-06'].includes(
        String(delta.status)
      )
    )
      return NextResponse.json(
        { error: 'ステータスが不正です' },
        { status: 400 }
      )
    const updatedAt = await patchReservation(id, delta, expectedUpdatedAt)
    return NextResponse.json({ ok: true, updatedAt })
  } catch (err) {
    console.error('[PATCH /api/reservations]', err)
    if (err instanceof ReservationConflictError)
      return NextResponse.json(
        { error: err.message, conflict: true },
        { status: 409 }
      )
    if (err instanceof StoreBusyError || err instanceof RateLimitedError)
      return NextResponse.json(
        { error: '保存処理中です。時間をおいて再度お試しください。' },
        { status: 503 }
      )
    return NextResponse.json(
      { error: 'Failed to update reservation' },
      { status: 500 }
    )
  }
}
