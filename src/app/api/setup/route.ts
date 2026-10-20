import { NextResponse } from 'next/server'
import { initializeSheets } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

/**
 * POST /api/setup
 * 既存シートをバックアップしてヘッダー名に基づき移行する（スタッフ認証が必要）。
 * 本番環境では実行後にこのルートを削除またはアクセス制限すること。
 */
export async function POST() {
  try {
    const result=await initializeSheets()
    return NextResponse.json({ ok: true, result, message: 'スプレッドシートを移行しました' })
  } catch (err) {
    console.error('[GET /api/setup]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
