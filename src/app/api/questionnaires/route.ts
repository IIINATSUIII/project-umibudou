import { NextRequest, NextResponse } from 'next/server'
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
    const body = await req.json()
    await store.addQuestionnaire(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
