import { NextRequest } from 'next/server'
import {
  createSessionToken,
  verifySessionToken,
  validateCredentials,
  SESSION_COOKIE,
  SessionConfigurationError,
} from '@/lib/session'
import { staffJson } from '@/lib/staffAuth'

export const dynamic = 'force-dynamic'

const COOKIE_OPTS = {
  httpOnly: true,   // JS からアクセス不可（XSS対策）
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7日間
}

/** POST /api/auth — ログイン */
export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return staffJson({ error: 'Invalid login input' }, { status: 400 })
  }
  const { email, password } = body as Record<string, unknown>
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password.trim()) {
    return staffJson({ error: 'Invalid login input' }, { status: 400 })
  }

  if (!validateCredentials(email, password)) {
    return staffJson(
      { error: 'メールアドレスまたはパスワードが正しくありません' },
      { status: 401 }
    )
  }

  try {
    const token = await createSessionToken(email)
    const res = staffJson({ ok: true, email })
    res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
    return res
  } catch (error) {
    console.error('[POST /api/auth] AUTH_UNAVAILABLE')
    return staffJson({ error: 'AUTH_UNAVAILABLE' }, {
      status: error instanceof SessionConfigurationError ? 503 : 500,
    })
  }
}

/** DELETE /api/auth — ログアウト */
export async function DELETE() {
  const res = staffJson({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}

/** GET /api/auth — 現在のユーザー情報を返す */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return staffJson({ user: null })

  try {
    const payload = await verifySessionToken(token)
    const response = staffJson({ user: payload })
    if (!payload) response.cookies.delete(SESSION_COOKIE)
    return response
  } catch {
    console.error('[GET /api/auth] AUTH_UNAVAILABLE')
    return staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  }
}
