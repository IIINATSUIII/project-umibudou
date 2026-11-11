import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import { getQrError, isReservationActive } from '@/lib/questionnaireToken'
import { dismissCheckinHandoff, enqueueCheckinHandoff, isSheetsStore, listCheckinHandoffs } from '@/lib/checkinHandoffStore'
import type { QuestionnaireData, Reservation } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
async function authorize(req: NextRequest, mutation = false) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token || !await verifySessionToken(token)) return response({ error: 'スタッフのログインが必要です。' }, 401)
  if (mutation && req.headers.get('origin') !== req.nextUrl.origin) return response({ error: '同じサイトから操作してください。' }, 403)
  return null
}
function available(q: QuestionnaireData, reservations: Reservation[]) {
  const reservation = reservations.find(r => r.id === q.reservationId)
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  return !getQrError(q) && reservation && isReservationActive(reservation) && reservation.diveDate === today
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req)
  if (denied) return denied
  try {
    const [pending, questionnaires, reservations] = await Promise.all([listCheckinHandoffs(), store.getQuestionnaires(), store.getReservations()])
    const items = pending.flatMap(item => {
      const q = questionnaires.find(q => q.id === item.questionnaireId)
      return q && available(q, reservations) ? [{ id: item.id, questionnaireId: q.id, name: `${q.lastName} ${q.firstName}`, createdAt: item.createdAt }] : []
    })
    return response({ items, pollIntervalMs: isSheetsStore() ? 15000 : 5000 })
  } catch {
    return response({ error: '受付待ちを取得できませんでした。' }, 503)
  }
}

export async function POST(req: NextRequest) {
  const denied = await authorize(req, true)
  if (denied) return denied
  let body: { qrToken?: unknown }
  try { body = await req.json() } catch { return response({ error: '送信内容が不正です。' }, 400) }
  if (!body || typeof body.qrToken !== 'string' || !body.qrToken || body.qrToken.length > 200) return response({ error: '受付QRを読み取ってください。' }, 400)
  try {
    const [questionnaires, reservations] = await Promise.all([store.getQuestionnaires(), store.getReservations()])
    const q = questionnaires.find(q => q.qrToken === body.qrToken)
    if (!q || !available(q, reservations)) return response({ error: 'このQRは受付できません。当日分・期限・受付済み状態をPCで確認してください。' }, 400)
    await enqueueCheckinHandoff(q.id, q.qrExpiresAt!)
    return response({ name: `${q.lastName} ${q.firstName}` })
  } catch {
    return response({ error: 'PCへ送信できませんでした。再度お試しください。' }, 503)
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await authorize(req, true)
  if (denied) return denied
  let body: { id?: unknown }
  try { body = await req.json() } catch { return response({ error: '送信内容が不正です。' }, 400) }
  if (!body || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) return response({ error: '受付待ちIDが不正です。' }, 400)
  try {
    await dismissCheckinHandoff(body.id)
    return response({ ok: true })
  } catch {
    return response({ error: '受付待ちを更新できませんでした。' }, 503)
  }
}
