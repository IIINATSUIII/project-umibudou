import { NextResponse } from 'next/server'
import { initializeSheets } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/setup
 * 空のスプレッドシートにヘッダー行を書き込む（初回のみ。既存シートは変更しない）。
 * 本番環境では実行後にこのルートを削除またはアクセス制限すること。
 */
export async function GET() {
  try {
    await initializeSheets()
    return NextResponse.json({ ok: true, message: 'スプレッドシートを初期化しました' })
  } catch (err) {
    console.error('[GET /api/setup]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
