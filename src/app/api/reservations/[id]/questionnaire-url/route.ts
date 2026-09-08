import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { generateQuestionnaireToken, getQuestionnaireExpiry } from '@/lib/questionnaireToken'

export const runtime = 'nodejs'

/** POST /api/reservations/[id]/questionnaire-url — 問診票URLを発行・再発行 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const reservations = await store.getReservations()
    const reservation = reservations.find((item) => item.id === params.id)

    if (!reservation) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
    }
    if (reservation.status === 'cancelled') {
      return NextResponse.json({ error: 'キャンセル済みの予約には発行できません' }, { status: 409 })
    }

    const expiresAt = getQuestionnaireExpiry(reservation.date)
    if (Date.parse(expiresAt) <= Date.now()) {
      return NextResponse.json({ error: 'ダイブ日を過ぎた予約には発行できません' }, { status: 409 })
    }

    let token = generateQuestionnaireToken()
    while (reservations.some((item) => item.questionnaireToken === token)) {
      token = generateQuestionnaireToken()
    }

    await store.updateReservation(reservation.id, {
      questionnaireToken: token,
      questionnaireExpiresAt: expiresAt,
    })

    return NextResponse.json({
      token,
      expiresAt,
      url: new URL(`/questionnaire/${token}`, req.nextUrl.origin).toString(),
    })
  } catch (err) {
    console.error('[POST /api/reservations/[id]/questionnaire-url]', err)
    return NextResponse.json({ error: '問診票URLの発行に失敗しました' }, { status: 500 })
  }
}
