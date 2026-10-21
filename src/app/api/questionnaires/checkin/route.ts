import { NextRequest, type NextResponse } from 'next/server'
import { requireStaffSession, staffJson } from '@/lib/staffAuth'
import { store } from '@/lib/dataStore'
import { isConfirmedReservationStatus } from '@/lib/reservationStatus'

import { getQrError } from '@/lib/questionnaireToken'
import { RateLimitedError } from '@/lib/withRetry'
import { MSG } from '@/lib/messages'

export const dynamic = 'force-dynamic'

let checkinQueue: Promise<void> = Promise.resolve()

/** GET /api/questionnaires/checkin?token=... — 最新の票と予約状態でQRを照合する */
export async function GET(req: NextRequest) { const auth = await requireStaffSession(req);
  if (!auth.ok) {
    return auth.response
  }

  const token = req.nextUrl.searchParams.get('token')?.trim() ?? ''
  if (token.length < 20 || token.length > 128) {
    return staffJson({ error: '受付用QRコードではありません。' }, { status: 400 })
  }

  try {
    const [candidates, reservations] = await Promise.all([
      store.searchQuestionnaires(token),
      store.getReservations(),
    ])
    const questionnaire = candidates.find((item) => item.qrToken === token)
    if (!questionnaire) {
      return staffJson(
        { error: 'MSG-11：該当する問診情報が見つかりません。' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const reservation = reservations.find(
      (item) => item.id === questionnaire.reservationId,
    )
    if (!reservation || !isConfirmedReservationStatus(reservation.status)) {
      return staffJson(
        { error: '確定済みの予約を確認できません。' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
    if (reservation.diveDate !== today) {
      return staffJson(
        { error: '本日の予約ではないため受付できません。' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const qrError = getQrError(questionnaire)
    if (qrError === 'QR_USED') {
      return staffJson(
        { error: 'MSG-22：このQRコードは受付済みです。' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (qrError) {
      return staffJson(
        { error: 'MSG-10：QRコードの有効期限が切れています。受付にお申し出ください。' },
        { status: 410, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return staffJson(
      { questionnaire, reservation },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return staffJson(
        { error: MSG.RATE_LIMITED },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    console.error('[GET /api/questionnaires/checkin]', error)
    return staffJson(
      { error: '受付情報を確認できませんでした。時間をおいて再度お試しください。' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

/** POST /api/questionnaires/checkin — スタッフが読み取った受付QRを使用済みにする */
export async function POST(req: NextRequest) {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response


  let response: NextResponse | null = null
  const processCheckin = async () => {
    try {
      const body: unknown = await req.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        response = staffJson({ error: 'QRコードを読み取れませんでした。' }, { status: 400 })
        return
      }

      const token = (body as Record<string, unknown>).token
      if (typeof token !== 'string' || token.trim().length < 20 || token.trim().length > 128) {
        response = staffJson({ error: '受付用QRコードではありません。' }, { status: 400 })
        return
      }

      const normalizedToken = token.trim()
      const candidates = await store.searchQuestionnaires(normalizedToken)
      const questionnaire = candidates.find((item) => item.qrToken === normalizedToken)
      if (!questionnaire) {
        response = staffJson({ error: '受付用QRコードが見つかりません。' }, { status: 404 })
        return
      }

      const reservation = (await store.getReservations())
        .find((item) => item.id === questionnaire.reservationId && isConfirmedReservationStatus(item.status))
      if (!reservation) {
        response = staffJson({ error: '確定済みの予約を確認できません。' }, { status: 409 })
        return
      }

      const expiresAt = questionnaire.qrExpiresAt ? new Date(questionnaire.qrExpiresAt).getTime() : Number.NaN
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        response = staffJson({ error: '受付用QRコードの有効期限が切れています。' }, { status: 410 })
        return
      }

      if (questionnaire.qrUsed) {
        response = staffJson({
          questionnaireId: questionnaire.id,
          alreadyCheckedIn: true,
        })
        return
      }

      await store.updateQuestionnaire(questionnaire.id, { qrUsed: true })
      response = staffJson({
        questionnaireId: questionnaire.id,
        alreadyCheckedIn: false,
      })
    } catch (error) {
      console.error('[POST /api/questionnaires/checkin]', error)
      response = staffJson({ error: '受付を記録できませんでした。時間をおいて再度お試しください。' }, { status: 500 })
    }
  }

  const operation = checkinQueue.then(processCheckin, processCheckin)
  checkinQueue = operation.then(() => undefined, () => undefined)
  await operation
  return response ?? staffJson({ error: '受付を記録できませんでした。' }, { status: 500 })
}
