import { nextUpdatedAt } from '@/lib/updateVersion'
import { requireStaffSession, staffJson } from '@/lib/staffAuth'
import { NextRequest } from 'next/server'
import { store } from '@/lib/dataStore'
import { withStoreWriteLock, StoreBusyError } from '@/lib/storeLock'
import {
  generateQuestionnaireToken,
  getQuestionnaireExpiry,
  isQuestionnaireUrlValid,
  isReservationActive,
} from '@/lib/questionnaireToken'
export async function POST(req: NextRequest) {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response

  const body: unknown = await req.json().catch(() => null)
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof (body as { id?: unknown }).id !== 'string'
  )
    return staffJson({ error: '予約IDが必要です' }, { status: 400 })
  const input = body as { id: string; reissue?: boolean }
  try {
    return await withStoreWriteLock(async () => {
      const r = (await store.getReservations()).find((r) => r.id === input.id)
      if (
        !r ||
        !isReservationActive(r) ||
        Date.parse(getQuestionnaireExpiry(r.diveDate)) <= Date.now()
      )
        return staffJson(
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
      return staffJson({
        questionnaireToken: token,
        questionnaireTokenExpiresAt: expiry,
      }, { headers: { 'Cache-Control': 'no-store' } })
    })
  } catch (err) {
    return staffJson(
      { error: err instanceof Error ? err.message : '発行できませんでした' },
      { status: err instanceof StoreBusyError ? 503 : 500 }
    )
  }
}

export const dynamic = 'force-dynamic'

/** 入力URLだけを失効させる。提出済みの同意・受付QRは変更しない。 */
export async function DELETE(req: NextRequest) {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body.id !== 'string')
    return staffJson({ error: '予約IDが必要です' }, { status: 400 })
  try {
    return await withStoreWriteLock(async () => {
      const r = (await store.getReservations()).find(r => r.id === body.id)
      if (!r) return staffJson({ error: '予約が見つかりません' }, { status: 404 })
      await store.updateReservation(r.id, { questionnaireToken: '', questionnaireTokenExpiresAt: '', updatedAt: nextUpdatedAt(r.updatedAt) })
      return staffJson({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
    })
  } catch (err) {
    return staffJson({ error: '入力URLを失効できませんでした' }, { status: err instanceof StoreBusyError ? 503 : 500 })
  }
}
