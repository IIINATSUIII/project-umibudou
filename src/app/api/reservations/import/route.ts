import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import { CsvFormatError, importOtaCsv, OTA_CSV_MAX_CHARS } from '@/lib/otaCsvImport'
import { MSG } from '@/lib/messages'
import { RateLimitedError } from '@/lib/withRetry'
import { StoreBusyError } from '@/lib/storeLock'

export const runtime = 'nodejs'

async function isStaff(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return Boolean(token && await verifySessionToken(token))
}

/**
 * POST /api/reservations/import — OTA予約CSVの取込（SC-03、Issue #64）
 * body: { csv: string, dryRun?: boolean }。文字コードの判定はブラウザ側で済ませた文字列を受け取る。
 * dryRun=true は保存せず行ごとの判定だけを返す。
 */
export async function POST(req: NextRequest) {
  if (!await isStaff(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body: unknown = await req.json().catch(() => null)
    const values = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
    if (!values || typeof values.csv !== 'string') {
      return NextResponse.json({ error: MSG.CSV_FORMAT, detail: 'CSVの内容が送信されていません' }, { status: 400 })
    }
    if (values.csv.length > OTA_CSV_MAX_CHARS) {
      return NextResponse.json({ error: MSG.CSV_FORMAT, detail: 'ファイルが大きすぎます（2MBまで）' }, { status: 413 })
    }
    const result = await importOtaCsv(values.csv, { dryRun: values.dryRun === true })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CsvFormatError) {
      return NextResponse.json({ error: MSG.CSV_FORMAT, detail: err.message }, { status: 400 })
    }
    console.error('[POST /api/reservations/import]', err)
    if (err instanceof RateLimitedError) return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503 })
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: '保存処理中です。時間をおいて再度お試しください。' }, { status: 503 })
    }
    return NextResponse.json({ error: 'CSVを取り込めませんでした。時間をおいて再度お試しください。' }, { status: 500 })
  }
}
