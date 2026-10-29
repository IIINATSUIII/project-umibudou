import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'
import { requireStaffSession } from '@/lib/staffAuth'

// ログイン不要のパス
const PUBLIC_PATHS = [
  '/login',
  '/booking',      // 客側：予約申し込みフォーム
  '/line-menu',    // LINEリッチメニューから開くゲスト向け画面
  '/_next',
]

function isPublic(pathname: string): boolean {
  // トップページは認証状態を見てクライアント側で /login または /dashboard へ遷移する。
  // SESSION_SECRET未設定でも、認証エラーJSONを画面へ直接表示しない。
  if (pathname === '/') return true
  // Staff-only scan must stay protected even though /questionnaire/[id] is public.
  if (pathname === '/questionnaire/scan' || pathname.startsWith('/questionnaire/scan/')) return false
  // The handler still requires its own CRON_SECRET bearer token.
  if (pathname === '/api/cron/sheets-outbox' || pathname === '/api/cron/reservation-emails') return true
  if (pathname === '/api/auth' || pathname === '/api/auth/register' || pathname.startsWith('/api/auth/invitations/preview') || pathname.startsWith('/api/public/')) return true
  if (pathname === '/favicon.ico' || pathname === '/line-rich-menu.png') return true
  // おさかな図鑑の判定に使う、モデルと実行用ファイル（静的ファイル。ログイン不要の /line-menu/fish が読み込む）
  if (pathname.startsWith('/models/fish/') || pathname.startsWith('/ort/')) return true
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true
  // ダイバー向け問診票入力画面はログイン不要（/questionnaire/[id] のみ）
  if (/^\/questionnaire\/[^/]+\/?$/.test(pathname)) return true
  return false
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  const auth = await requireStaffSession(req)
  if (auth.ok) return NextResponse.next()
  if (pathname === '/api' || pathname.startsWith('/api/') || auth.response.status !== 401) return auth.response

  // Only page requests redirect; API callers receive JSON from the guard.
  const res = NextResponse.redirect(new URL('/login', req.url))
  res.headers.set('Cache-Control', 'no-store')
  if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE)
  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

