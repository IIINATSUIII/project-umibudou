import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { isQrValid } from '@/lib/questionnaireToken'

/** GET /api/questionnaires?q=... — 条件を指定して問診票を検索 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
    if (id) {
      const questionnaire = await store.getQuestionnaireById(id)
      return questionnaire
        ? NextResponse.json(questionnaire)
        : NextResponse.json({ error: '問診票が見つかりません' }, { status: 404 })
    }

    const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (!query) return NextResponse.json([])
    if (query.length > 200) {
      return NextResponse.json({ error: '検索語が長すぎます' }, { status: 400 })
    }
    const matches = await store.searchQuestionnaires(query)
    const qrMatch = matches.find((questionnaire) => questionnaire.qrToken === query)
    if (qrMatch && (!isQrValid(qrMatch) || (await store.getReservations()).find((r) => r.id === qrMatch.reservationId)?.status === 'cancelled')) {
      return NextResponse.json({ error: 'QR_EXPIRED' }, { status: 410 })
    }
    return NextResponse.json(matches.map((questionnaire) => ({
      id: questionnaire.id,
      reservationId: questionnaire.reservationId,
      submittedAt: questionnaire.submittedAt,
      lastName: questionnaire.lastName,
      firstName: questionnaire.firstName,
      lastNameKana: questionnaire.lastNameKana,
      firstNameKana: questionnaire.firstNameKana,
      phone: questionnaire.phone,
    })))
  } catch (err) {
    console.error('[GET /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to fetch questionnaires' }, { status: 500 })
  }
}

// All submissions share the same token and validation contract.
export { POST } from '../public/questionnaires/route'
