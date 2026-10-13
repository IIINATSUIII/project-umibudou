import { NextRequest, type NextResponse } from 'next/server'
import { requireStaffSession, staffJson } from '@/lib/staffAuth'
import { store } from '@/lib/dataStore'
import { isConfirmedReservationStatus } from '@/lib/reservationStatus'

export const dynamic = 'force-dynamic'

let checkinQueue: Promise<void> = Promise.resolve()

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
