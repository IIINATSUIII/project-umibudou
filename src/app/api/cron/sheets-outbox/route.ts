import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { USE_POSTGRES } from '@/lib/dataStore'
import { runSheetsOutboxWorker } from '@/lib/sheetsOutboxWorker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const authorization = request.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const provided = Buffer.from(authorization)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!USE_POSTGRES) {
    return NextResponse.json({ error: 'PostgreSQL datastore is not enabled' }, { status: 503 })
  }

  try {
    return NextResponse.json(await runSheetsOutboxWorker())
  } catch (error) {
    // Avoid logging driver/Sheets error messages, which can contain request data.
    console.error('[POST /api/cron/sheets-outbox]', error instanceof Error ? error.name : 'UnknownError')
    return NextResponse.json({ error: 'Outbox delivery failed' }, { status: 500 })
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}
