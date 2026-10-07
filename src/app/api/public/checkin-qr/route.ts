import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { isConfirmedReservationStatus } from '@/lib/reservationStatus'
import {
  deriveReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from '@/lib/reservationQuestionnaireToken'

function matchesToken(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}

/**
 * POST /api/public/checkin-qr — 推測困難な予約確認コードを検証して受付QRを返す。
 * 問診票の健康情報は公開APIから返さない。
 */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '予約情報をご確認ください。' }, { status: 400 })
    }

    const values = body as Record<string, unknown>
    const reservationId = typeof values.reservationId === 'string' ? values.reservationId.trim() : ''
    const reservationToken = typeof values.reservationToken === 'string' ? values.reservationToken.trim() : ''
    if (!reservationId || reservationId.length > 64 || reservationToken.length < 20 || reservationToken.length > 128) {
      return NextResponse.json({ error: '予約情報をご確認ください。' }, { status: 400 })
    }

    const reservations = await store.getReservations()
    const reservation = reservations.find((item) => item.id === reservationId && isConfirmedReservationStatus(item.status))
    const expectedToken = reservation && (reservation.questionnaireToken ?? deriveReservationQuestionnaireToken(reservation.id))
    if (!reservation || !expectedToken || !matchesToken(reservationToken, expectedToken)) {
      return NextResponse.json({ error: '予約を確認できませんでした。予約時の案内をご確認ください。' }, { status: 404 })
    }

    const tokenExpiry = reservation.questionnaireTokenExpiresAt ?? questionnaireTokenExpiryForDiveDate(reservation.diveDate)
    const tokenExpiryMs = tokenExpiry ? new Date(tokenExpiry).getTime() : Number.NaN
    if (!Number.isFinite(tokenExpiryMs) || tokenExpiryMs <= Date.now()) {
      return NextResponse.json({ error: '予約確認コードの有効期限が切れています。ショップへお問い合わせください。' }, { status: 410 })
    }

    const questionnaires = (await store.getQuestionnaires())
      .filter((item) => item.reservationId === reservation.id)
    const participants = questionnaires.map((item) => {
      const expiresAt = item.qrExpiresAt
      const expiry = expiresAt ? new Date(expiresAt).getTime() : Number.NaN
      const usable = Boolean(item.qrToken && Number.isFinite(expiry) && expiry > Date.now() && !item.qrUsed)
      return {
        name: `${item.lastName} ${item.firstName}`.trim(),
        ...(usable ? { token: item.qrToken, expiresAt } : {}),
        used: item.qrUsed === true,
      }
    })

    const questionnaireUrl = `/questionnaire/${encodeURIComponent(reservation.id)}?token=${encodeURIComponent(expectedToken)}`

    return NextResponse.json({
      reservation: {
        diveDate: reservation.diveDate,
        time: reservation.time,
        timeSlot: reservation.timeSlot,
        courseName: reservation.courseName,
        guestCount: reservation.guestCount,
      },
      participants,
      questionnaireUrl,
      incompleteCount: Math.max(0, reservation.guestCount - questionnaires.length),
    })
  } catch (error) {
    console.error('[POST /api/public/checkin-qr]', error)
    return NextResponse.json({ error: '予約を確認できませんでした。時間をおいて再度お試しください。' }, { status: 500 })
  }
}
