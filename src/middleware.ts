import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/session'

// ログイン不要のパス
const PUBLIC_PATHS = [
  '/login',
  '/booking',      // 客側：予約申し込みフォーム
  '/api/auth',
  '/api/public',   // 客側：予約申し込み・問診票提出API
  '/_next',
  '/favicon',
]

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return true
  // ダイバー向け問診票入力画面はログイン不要（/questionnaire/[id] のみ）
  if (/^\/questionnaire\/[^/]+\/?$/.test(pathname)) return true
  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()

  // シークレット未設定のまま検証すると全リクエストが「無効なトークン」扱いになり
  // /login への無限リダイレクトになるため、設定漏れは明示的にエラーにする
  if (!process.env.SESSION_SECRET) {
    console.error(
      '[middleware] SESSION_SECRET が未設定です。.env.local を確認して dev サーバーを再起動してください。'
    )
    return new NextResponse('Server misconfiguration: SESSION_SECRET is not set', {
      status: 500,
    })
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const payload = await verifySessionToken(token)
  if (payload) return NextResponse.next()

  // トークンが無効 → ログインへ
  const res = NextResponse.redirect(new URL('/login', req.url))
  res.cookies.delete(SESSION_COOKIE)
  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
