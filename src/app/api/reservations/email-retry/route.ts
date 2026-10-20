import { NextRequest, NextResponse } from 'next/server'
import { retryReservationEmail } from '@/lib/reservationEmailWorker'

/** POST /api/reservations/email-retry — スタッフ用の受付メール手動再送。 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null)
  const reservationId = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as { reservationId?: unknown }).reservationId
    : undefined
  if (typeof reservationId !== 'string' || !/^R-[A-Za-z0-9-]{1,180}$/.test(reservationId))
    return NextResponse.json({ error: '予約IDが不正です' }, { status: 400 })

  const result = await retryReservationEmail(reservationId)
  if (result === 'not_found')
    return NextResponse.json({ error: '受付メールが見つかりません' }, { status: 404 })
  if (result === 'already_sent')
    return NextResponse.json({ error: '受付メールは送信済みです' }, { status: 409 })
  return NextResponse.json({ ok: true, status: 'requeued' })
}
