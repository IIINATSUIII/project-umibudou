import { NextRequest } from 'next/server'
import {
  AuthConfigurationError,
  createSessionToken,
  isNonEmptyString,
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

function invalidLoginRequest() {
  return NextResponse.json(
    { error: 'メールアドレスとパスワードを正しく入力してください' },
    { status: 400 }
  )
}

/** POST /api/auth — ログイン */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return invalidLoginRequest()
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidLoginRequest()
  }
  const { email, password } = body as Record<string, unknown>
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return invalidLoginRequest()
  }

  try {
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
  } catch (error) {
    // 認証設定・パスワード・JWTを応答やログへ含めない。
    if (error instanceof AuthConfigurationError) {
      console.error('[auth] AUTH_CONFIGURATION_INVALID')
      return NextResponse.json(
        { error: '現在ログインを利用できません。時間をおいて再度お試しください' },
        { status: 503 }
      )
    }
    console.error('[auth] AUTH_INTERNAL_ERROR')
    return NextResponse.json(
      { error: 'ログイン処理に失敗しました。時間をおいて再度お試しください' },
      { status: 500 }
    )
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
