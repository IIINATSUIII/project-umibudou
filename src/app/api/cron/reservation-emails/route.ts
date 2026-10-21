import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runReservationEmailOutbox } from '@/lib/reservationEmailWorker'
import { EmailConfigurationError } from '@/lib/reservationEmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const provided = Buffer.from(request.headers.get('authorization') ?? '')
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runReservationEmailOutbox())
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (error instanceof EmailConfigurationError)
      return NextResponse.json({ error: 'メール送信設定がありません' }, { status: 503 })
    console.error('[reservation-email-outbox]', name || 'UnknownError')
    return NextResponse.json({ error: 'メール送信処理に失敗しました' }, { status: 500 })
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}
