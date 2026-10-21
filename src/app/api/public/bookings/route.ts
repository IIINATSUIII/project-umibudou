import { NextRequest, NextResponse } from 'next/server'
import { createReservation } from '@/lib/reservations'
import { DEFAULT_STATUS_ID } from '@/lib/masters'
import {
  validateNewReservationInput,
  ReservationValidationError,
} from '@/lib/reservationValidation'
import { ReservationIdempotencyConflictError } from '@/lib/reservations'
import { StoreBusyError } from '@/lib/storeLock'

/**
 * POST /api/public/bookings — 客側予約申し込み（ログイン不要）
 * 「予約受付（仮押さえ）の新規作成」のみ許可。
 * id / status / channel はサーバー側で強制し、閲覧・更新は一切できない。
 */
export async function POST(req: NextRequest) {
  try {
    const requestKey = req.headers.get('idempotency-key')?.trim() ?? ''
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey)) {
      return NextResponse.json(
        { error: 'Idempotency-Key ヘッダーが必要です' },
        { status: 400 },
      )
    }
    const body = await req.json().catch(() => null) as unknown
    const validationInput = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), channel: 'hp', status: DEFAULT_STATUS_ID }
      : body
    const validation = validateNewReservationInput(validationInput, {
      allowOta: false,
      allowPastDate: false,
    })
    if (!validation.ok) {
      return NextResponse.json({
        error: 'VALIDATION_ERROR',
        message: validation.message,
        fields: validation.fields,
      }, { status: 400 })
    }

    const reservation = await createReservation({
      ...validation.data,
      channel: 'hp',
      status: DEFAULT_STATUS_ID, // スタッフ承認制：確定は店側画面で行う
    }, { sendReceipt: true, requestKey })
    // 完了画面でQR生成・予約番号表示に使うため id を返す
    return NextResponse.json({ ok: true, id: reservation.id, questionnaireToken:reservation.questionnaireToken, questionnaireTokenExpiresAt:reservation.questionnaireTokenExpiresAt })
  } catch (err) {
    if (err instanceof ReservationIdempotencyConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    if (err instanceof ReservationValidationError) {
      return NextResponse.json({
        error: 'VALIDATION_ERROR',
        message: err.message,
        fields: err.fields,
      }, { status: 400 })
    }
    console.error('[POST /api/public/bookings]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
