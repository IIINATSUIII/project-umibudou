import { nextUpdatedAt } from '@/lib/updateVersion'
import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { withStoreWriteLock, StoreBusyError } from '@/lib/storeLock'
import {
  generateQuestionnaireToken,
  getQuestionnaireExpiry,
  isQuestionnaireUrlValid,
} from '@/lib/questionnaireToken'
export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null)
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof (body as { id?: unknown }).id !== 'string'
  )
    return NextResponse.json({ error: '予約IDが必要です' }, { status: 400 })
  const input = body as { id: string; reissue?: boolean }
  try {
    return await withStoreWriteLock(async () => {
      const r = (await store.getReservations()).find((r) => r.id === input.id)
      if (
        !r ||
        ['STS-04', 'STS-06'].includes(r.status) ||
        Date.parse(getQuestionnaireExpiry(r.diveDate)) <= Date.now()
      )
        return NextResponse.json(
          { error: '発行できる予約がありません' },
          { status: 404 }
        )
      let token = r.questionnaireToken
      let expiry = r.questionnaireTokenExpiresAt
      if (input.reissue === true || !isQuestionnaireUrlValid(r)) {
        token = generateQuestionnaireToken()
        expiry = getQuestionnaireExpiry(r.diveDate)
        await store.updateReservation(r.id, {
          questionnaireToken: token,
          questionnaireTokenExpiresAt: expiry,
          updatedAt: nextUpdatedAt(r.updatedAt),
        })
      }
      return NextResponse.json({
        questionnaireToken: token,
        questionnaireTokenExpiresAt: expiry,
      })
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '発行できませんでした' },
      { status: err instanceof StoreBusyError ? 503 : 500 }
    )
  }
}
