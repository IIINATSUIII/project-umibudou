import { NextRequest, NextResponse } from 'next/server'
import { validateQuestionnaireExperience, normalizeQuestionnaireExperience } from '@/lib/questionnaireValidation'
import { store } from '@/lib/dataStore'

/** GET /api/questionnaires — 問診票一覧取得 */
export async function GET() {
  try {
    return NextResponse.json(await store.getQuestionnaires())
  } catch (err) {
    console.error('[GET /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to fetch questionnaires' }, { status: 500 })
  }
}

/** POST /api/questionnaires — 問診票提出 */
export async function POST(req: NextRequest) {
  try {
    let body
    try { body = await req.json() } catch {
      return NextResponse.json({ error: '不正なJSONです' }, { status: 400 })
    }
    const fieldErrors = validateQuestionnaireExperience(body)
    if (Object.keys(fieldErrors).length) return NextResponse.json({ error: '入力内容を確認してください', fieldErrors }, { status: 400 })
    body = normalizeQuestionnaireExperience(body)
    await store.addQuestionnaire(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
