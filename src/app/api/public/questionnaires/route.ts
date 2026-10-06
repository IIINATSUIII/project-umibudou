import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { findReservationByQuestionnaireToken } from '@/lib/questionnaireToken'
import {
  saveSubmission,
  SubmissionValidationError,
} from '@/lib/questionnaireSubmission'
import { StoreBusyError, withStoreWriteLock } from '@/lib/storeLock'
import type { QuestionnaireData } from '@/types'
export const dynamic = 'force-dynamic'
function success(q: QuestionnaireData) {
  return {
    ok: true,
    questionnaireId: q.id,
    qrToken: q.qrToken,
    qrExpiresAt: q.qrExpiresAt,
    lastName: q.lastName,
    firstName: q.firstName,
  }
}
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('accessToken') || ''
    const reservation = findReservationByQuestionnaireToken(
      await store.getReservations(),
      token
    )
    if (!reservation)
      return NextResponse.json(
        { error: '予約URLが無効、または期限切れです' },
        { status: 404 }
      )
    const q = (await store.getQuestionnaires()).find(
      (q) => q.reservationId === reservation.id
    )
    return NextResponse.json(
      q?.submissionState === 'complete'
        ? { ...success(q), submitted: true }
        : { submitted: false },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      { error: '送信状態を確認できませんでした' },
      { status: 500 }
    )
  }
}
export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json(
      { error: 'JSON形式の入力が不正です' },
      { status: 400 }
    )
  const input = body as Record<string, unknown>
  try {
    return await withStoreWriteLock(async () => {
      const token =
        typeof input.accessToken === 'string' ? input.accessToken : ''
      const reservation = findReservationByQuestionnaireToken(
        await store.getReservations(),
        token
      )
      if (!reservation)
        return NextResponse.json(
          { error: '予約URLが無効、または期限切れです' },
          { status: 404 }
        )
      const q = await saveSubmission(reservation, input)
      return NextResponse.json(success(q), {
        headers: { 'Cache-Control': 'no-store' },
      })
    })
  } catch (err) {
    if (err instanceof SubmissionValidationError)
      return NextResponse.json(
        { error: err.message, errors: err.fields },
        { status: 400 }
      )
    if (err instanceof StoreBusyError)
      return NextResponse.json({ error: err.message }, { status: 503 })
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json(
      { error: '保存結果を確認できません。時間をおいて再送してください' },
      { status: 500 }
    )
  }
}
