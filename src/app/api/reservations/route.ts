import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { importGoogleFormBookings } from '@/lib/googleFormImport'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import {
  deriveReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from '@/lib/reservationQuestionnaireToken'
import {
  cancelledReservationStatus,
  isCancelledReservationStatus,
  isCancellableReservationStatus,
} from '@/lib/reservationStatus'
import type { ReservationInput } from '@/types'

/** GET /api/reservations — 予約一覧取得 */
export async function GET(req: NextRequest) {
  try {
    const sessionToken = req.cookies.get(SESSION_COOKIE)?.value
    if (!sessionToken || !await verifySessionToken(sessionToken)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Google Forms回答シートを先に同期し、一覧取得時に新着予約を自動反映する。
    const result = await importGoogleFormBookings()
    if (result.errors.length > 0) {
      console.warn('[GET /api/reservations] Googleフォーム取込:', result.errors)
    }
    const reservations = await store.getReservations()
    // 旧行のトークンは予約IDから決定的に導出し、並行GET間でも同じ値を返す。
    for (const reservation of reservations) {
      // Sheets は未入力セルを空文字として返すため、空白だけの値も未設定扱いにする。
      const storedQuestionnaireToken = reservation.questionnaireToken?.trim()
      const storedQuestionnaireTokenExpiresAt = reservation.questionnaireTokenExpiresAt?.trim()
      const questionnaireToken = storedQuestionnaireToken ||
        deriveReservationQuestionnaireToken(reservation.id)
      const questionnaireTokenExpiresAt = storedQuestionnaireTokenExpiresAt ||
        questionnaireTokenExpiryForDiveDate(reservation.diveDate)
      if (
        questionnaireToken !== reservation.questionnaireToken ||
        questionnaireTokenExpiresAt !== reservation.questionnaireTokenExpiresAt
      ) {
        await store.updateReservation(reservation.id, {
          questionnaireToken,
          questionnaireTokenExpiresAt,
        })
        reservation.questionnaireToken = questionnaireToken
        reservation.questionnaireTokenExpiresAt = questionnaireTokenExpiresAt
      }
    }
    return NextResponse.json(reservations)
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}

/** POST /api/reservations — 予約追加 */
export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value
  if (!sessionToken || !await verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const reservation = { ...(body as Record<string, unknown>) } as ReservationInput
    // 認可トークンと期限は常にサーバー側で発行する。
    delete reservation.questionnaireToken
    delete reservation.questionnaireTokenExpiresAt
    await store.addReservation(reservation)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to add reservation' }, { status: 500 })
  }
}

/** PATCH /api/reservations — 予約更新（idとdeltaをbodyに渡す） */
export async function PATCH(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value
  if (!sessionToken || !await verifySessionToken(sessionToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const id = typeof values.id === 'string' ? values.id.trim() : ''
    if (!id) return NextResponse.json({ error: '予約IDを指定してください' }, { status: 400 })
    const delta = { ...values }
    delete delta.id
    // クライアントからのtoken/expiry更新は無視する。diveDate変更時の期限再計算はstoreに任せる。
    delete delta.questionnaireToken
    delete delta.questionnaireTokenExpiresAt

    const requestedStatus = typeof delta.status === 'string' ? delta.status : undefined
    if (requestedStatus && isCancelledReservationStatus(requestedStatus)) {
      const current = (await store.getReservations()).find((reservation) => reservation.id === id)
      if (!current) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
      if (!isCancellableReservationStatus(current.status)) {
        return NextResponse.json({ error: 'この予約はキャンセルできません' }, { status: 409 })
      }
      // Keep the storage contract already used by this reservation: legacy text or STS ID.
      delta.status = cancelledReservationStatus(current)
    }

    await store.updateReservation(id, delta as ReservationInput)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
}
