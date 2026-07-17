import { NextRequest, NextResponse } from 'next/server'
import {
  createSessionToken,
  verifySessionToken,
  validateCredentials,
  SESSION_COOKIE,
} from '@/lib/session'

const COOKIE_OPTS = {
  httpOnly: true,   // JS からアクセス不可（XSS対策）
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7日間
}

/** POST /api/auth — ログイン */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!validateCredentials(email, password)) {
    return NextResponse.json(
      { error: 'メールアドレスまたはパスワードが正しくありません' },
      { status: 401 }
    )
  }

  const token = await createSessionToken(email)
  const res = NextResponse.json({ ok: true, email })
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
  return res
}

/** DELETE /api/auth — ログアウト */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}

/** GET /api/auth — 現在のユーザー情報を返す */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return NextResponse.json({ user: null })

  const payload = await verifySessionToken(token)
  return NextResponse.json({ user: payload })
}
