import { NextRequest } from 'next/server'
import { initializeSheets } from '@/lib/sheets'
import { requireStaffSession, staffJson } from '@/lib/staffAuth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/setup
 * 既存シートをバックアップしてヘッダー名に基づき移行する（スタッフ認証が必要）。
 * 開発環境で ENABLE_SHEETS_SETUP=true を設定した場合のみ利用できる。
 */
export async function POST(req: NextRequest) {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response
  if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_SHEETS_SETUP !== 'true') {
    return staffJson({ error: 'Not found' }, { status: 404 })
  }
  try {
    const result = await initializeSheets()
    return staffJson({ ok: true, result, message: 'スプレッドシートを移行しました' })
  } catch (err) {
    console.error('[POST /api/setup]', err instanceof Error ? err.name : 'UnknownError')
    return staffJson({ error: 'Spreadsheet setup failed' }, { status: 500 })
  }
}
