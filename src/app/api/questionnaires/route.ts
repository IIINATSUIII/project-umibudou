import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData } from '@/types'
import {
  saveSubmission,
  SubmissionValidationError,
} from '@/lib/questionnaireSubmission'
import { withStoreWriteLock } from '@/lib/storeLock'
import { getQrError } from '@/lib/questionnaireToken'

/** GET /api/questionnaires?q=... — 条件を指定して問診票を検索 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
    if (id) {
      const questionnaire = await store.getQuestionnaireById(id)
      return questionnaire
        ? NextResponse.json(questionnaire)
        : NextResponse.json(
            { error: '問診票が見つかりません' },
            { status: 404 }
          )
    }

    const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (!query) return NextResponse.json(await store.getQuestionnaires())
    if (query.length > 200) {
      return NextResponse.json({ error: '検索語が長すぎます' }, { status: 400 })
    }
    const matches = await store.searchQuestionnaires(query)
    const qrMatch = matches.find(
      (questionnaire) => questionnaire.qrToken === query
    )
    if (qrMatch && getQrError(qrMatch)) {
      return NextResponse.json({ error: getQrError(qrMatch) }, { status: 410 })
    }
    return NextResponse.json(
      matches.map((questionnaire) => ({
        id: questionnaire.id,
        reservationId: questionnaire.reservationId,
        submittedAt: questionnaire.submittedAt,
        lastName: questionnaire.lastName,
        firstName: questionnaire.firstName,
        lastNameKana: questionnaire.lastNameKana,
        firstNameKana: questionnaire.firstNameKana,
        phone: questionnaire.phone,
      }))
    )
  } catch (err) {
    console.error('[GET /api/questionnaires]', err)
    return NextResponse.json(
      { error: 'Failed to fetch questionnaires' },
      { status: 500 }
    )
  }
}

/** POST /api/questionnaires — 問診票提出 */
export async function POST(req: NextRequest) {
  try {
    const input: unknown = await req.json().catch(() => null)
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 })
    const body = input as Record<string, unknown>
    return await withStoreWriteLock(async () => {
      const r = (await store.getReservations()).find(
        (r) => r.id === body.reservationId
      )
      if (!r)
        return NextResponse.json(
          { error: '予約が見つかりません' },
          { status: 404 }
        )
      const q = await saveSubmission(r, body)
      return NextResponse.json({
        ok: true,
        questionnaireId: q.id,
        qrToken: q.qrToken,
        qrExpiresAt: q.qrExpiresAt,
      })
    })
  } catch (err) {
    if (err instanceof SubmissionValidationError)
      return NextResponse.json(
        { error: err.message, errors: err.fields },
        { status: 400 }
      )
    console.error('[POST /api/questionnaires]', err)
    return NextResponse.json(
      { error: 'Failed to save questionnaire' },
      { status: 500 }
    )
  }
}

/** スタッフ確認のみ更新可能。ダイバー本人の自己申告・同意は上書きしない。 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.id !== 'string')
    return NextResponse.json({ error: '問診IDが必要です' }, { status: 400 })
  const delta: Partial<QuestionnaireData> = {}
  if (body.doctorClearance !== undefined) {
    if (!['持参あり', 'なし', ''].includes(body.doctorClearance))
      return NextResponse.json(
        { error: '許可書確認の値が不正です' },
        { status: 400 }
      )
    delta.doctorClearance = body.doctorClearance
  }
  if (body.staffCheckStatus !== undefined) {
    if (!['未確認', '要対応', '確認済'].includes(body.staffCheckStatus))
      return NextResponse.json({ error: '確認状態が不正です' }, { status: 400 })
    delta.staffCheckStatus = body.staffCheckStatus
  }
  if (body.staffCheckNote !== undefined) {
    if (
      typeof body.staffCheckNote !== 'string' ||
      body.staffCheckNote.length > 1000
    )
      return NextResponse.json(
        { error: 'スタッフメモが不正です' },
        { status: 400 }
      )
    delta.staffCheckNote = body.staffCheckNote
  }
  try {
    await store.updateQuestionnaire(body.id, delta)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: '保存できませんでした' }, { status: 500 })
  }
}
