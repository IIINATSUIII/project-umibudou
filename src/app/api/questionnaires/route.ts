import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData } from '@/types'

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
    if (qrMatch?.qrExpiresAt && new Date(qrMatch.qrExpiresAt).getTime() <= Date.now()) {
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

/** POST /api/questionnaires — 問診票提出 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Omit<QuestionnaireData, 'id'>
    const questionnaire = await store.addQuestionnaire(body)
    return NextResponse.json({ ok: true, questionnaireId: questionnaire.id })
  } catch (err) {
    console.error('[POST /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
