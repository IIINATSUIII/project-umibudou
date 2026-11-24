import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { patchReservation, ReservationConflictError } from '@/lib/reservations'
import {
  cancellationRequestEligibility,
  CANCELLATION_REQUEST_MESSAGES,
  normalizeCancellationRequestNote,
  publicCancellationView,
} from '@/lib/cancellationRequest'
import { MSG } from '@/lib/messages'
import { RateLimitedError } from '@/lib/withRetry'
import { StoreBusyError } from '@/lib/storeLock'
import type { Reservation } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOT_FOUND = '予約を確認できませんでした。予約番号と確認コードをご確認ください。'
const SAVE_FAILED = 'キャンセル申請を保存できませんでした。キャンセルは成立していません。時間をおいて再度お試しいただくか、ショップへお電話ください。'

function reply(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function matchesToken(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}

/** 予約番号と確認コードが両方一致し、確認コードが有効な予約だけを返す。 */
async function findVerifiedReservation(reservationId: string, reservationToken: string): Promise<Reservation | undefined> {
  const reservation = (await store.getReservations()).find((item) => item.id === reservationId)
  const expected = reservation?.questionnaireToken
  if (!reservation || !expected || !matchesToken(reservationToken, expected)) return undefined
  const expiry = reservation.questionnaireTokenExpiresAt ? Date.parse(reservation.questionnaireTokenExpiresAt) : Number.NaN
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return undefined
  return reservation
}

/**
 * POST /api/public/cancellation-requests — お客様からのキャンセル申請（ログイン不要）。
 * action: 'status' は申請状況の確認、'request' は申請の登録。申請だけではキャンセルは成立しない。
 */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply({ error: '入力内容をご確認ください。' }, 400)
    }
    const values = body as Record<string, unknown>
    const action = values.action
    const reservationId = typeof values.reservationId === 'string' ? values.reservationId.trim() : ''
    const reservationToken = typeof values.reservationToken === 'string' ? values.reservationToken.trim() : ''
    if (action !== 'status' && action !== 'request') return reply({ error: '入力内容をご確認ください。' }, 400)
    if (!reservationId || reservationId.length > 64 || reservationToken.length < 20 || reservationToken.length > 128) {
      return reply({ error: NOT_FOUND }, 400)
    }
    const note = normalizeCancellationRequestNote(values.note)
    if (note === null) return reply({ error: 'キャンセル理由は200文字以内で入力してください。' }, 400)

    const reservation = await findVerifiedReservation(reservationId, reservationToken)
    if (!reservation) return reply({ error: NOT_FOUND }, 404)

    const now = new Date()
    if (action === 'status') return reply(publicCancellationView(reservation, now))

    const eligibility = cancellationRequestEligibility(reservation, now)
    if (!eligibility.ok) {
      // 再送や二重送信は、すでにある申請を返して成功扱いにする（申請を増やさない）。
      if (eligibility.reason === 'already_requested') {
        return reply({ ok: true, alreadyRequested: true, ...publicCancellationView(reservation, now) })
      }
      return reply({
        error: CANCELLATION_REQUEST_MESSAGES[eligibility.reason],
        reason: eligibility.reason,
        ...publicCancellationView(reservation, now),
      }, 409)
    }

    const requested: Reservation = {
      ...reservation,
      cancellationRequestStatus: 'pending',
      cancellationRequestedAt: now.toISOString(),
      ...(note ? { cancellationRequestNote: note } : {}),
    }
    try {
      await patchReservation(reservation.id, {
        cancellationRequestStatus: 'pending',
        cancellationRequestedAt: requested.cancellationRequestedAt,
        ...(note ? { cancellationRequestNote: note } : {}),
      }, reservation.updatedAt ?? '')
    } catch (error) {
      if (!(error instanceof ReservationConflictError)) throw error
      // 同時に送られた申請やスタッフの更新と重なった場合は、最新の状態で判断し直す。
      const latest = await findVerifiedReservation(reservationId, reservationToken)
      if (latest?.cancellationRequestStatus === 'pending') {
        return reply({ ok: true, alreadyRequested: true, ...publicCancellationView(latest, new Date()) })
      }
      return reply({ error: 'ほかの操作と重なったため申請できませんでした。もう一度お試しください。' }, 409)
    }
    return reply({ ok: true, alreadyRequested: false, ...publicCancellationView(requested, now) })
  } catch (error) {
    console.error('[POST /api/public/cancellation-requests]', error instanceof Error ? error.name : 'unknown')
    if (error instanceof RateLimitedError) return reply({ error: MSG.RATE_LIMITED }, 503)
    if (error instanceof StoreBusyError) return reply({ error: SAVE_FAILED }, 503)
    return reply({ error: SAVE_FAILED }, 500)
  }
}
