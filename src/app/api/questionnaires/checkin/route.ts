import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { isConfirmedReservationStatus } from '@/lib/reservationStatus'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'

async function isStaff(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return Boolean(token && await verifySessionToken(token))
}

let checkinQueue: Promise<void> = Promise.resolve()

/** POST /api/questionnaires/checkin — スタッフが読み取った受付QRを使用済みにする */
export async function POST(req: NextRequest) {
  if (!await isStaff(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let response: NextResponse | null = null
  const processCheckin = async () => {
    try {
      const body: unknown = await req.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        response = NextResponse.json({ error: 'QRコードを読み取れませんでした。' }, { status: 400 })
        return
      }

      const token = (body as Record<string, unknown>).token
      if (typeof token !== 'string' || token.trim().length < 20 || token.trim().length > 128) {
        response = NextResponse.json({ error: '受付用QRコードではありません。' }, { status: 400 })
        return
      }

      const normalizedToken = token.trim()
      const candidates = await store.searchQuestionnaires(normalizedToken)
      const questionnaire = candidates.find((item) => item.qrToken === normalizedToken)
      if (!questionnaire) {
        response = NextResponse.json({ error: '受付用QRコードが見つかりません。' }, { status: 404 })
        return
      }

      const reservation = (await store.getReservations())
        .find((item) => item.id === questionnaire.reservationId && isConfirmedReservationStatus(item.status))
      if (!reservation) {
        response = NextResponse.json({ error: '確定済みの予約を確認できません。' }, { status: 409 })
        return
      }

      const expiresAt = questionnaire.qrExpiresAt ? new Date(questionnaire.qrExpiresAt).getTime() : Number.NaN
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        response = NextResponse.json({ error: '受付用QRコードの有効期限が切れています。' }, { status: 410 })
        return
      }

      if (questionnaire.qrUsed) {
        response = NextResponse.json({
          questionnaireId: questionnaire.id,
          alreadyCheckedIn: true,
        })
        return
      }

      await store.updateQuestionnaire(questionnaire.id, { qrUsed: true })
      response = NextResponse.json({
        questionnaireId: questionnaire.id,
        alreadyCheckedIn: false,
      })
    } catch (error) {
      console.error('[POST /api/questionnaires/checkin]', error)
      response = NextResponse.json({ error: '受付を記録できませんでした。時間をおいて再度お試しください。' }, { status: 500 })
    }
  }

  const operation = checkinQueue.then(processCheckin, processCheckin)
  checkinQueue = operation.then(() => undefined, () => undefined)
  await operation
  return response ?? NextResponse.json({ error: '受付を記録できませんでした。' }, { status: 500 })
}
