import { NextRequest } from 'next/server'
import {
  AuthConfigurationError,
  createSessionToken,
  isNonEmptyString,
  validateCredentials,
  SESSION_COOKIE,
  SessionConfigurationError,
} from '@/lib/session'
import { resolveStaffToken, staffJson } from '@/lib/staffAuth'
import {
  canUseLocalStaffAuth,
  getStaffUserByEmail,
  hasStaffDatabase,
  ensureLegacyStaffUser,
  getLocalStaffUserByEmail,
  touchStaffLogin,
  verifyStaffPassword,
  type StaffUser,
} from '@/lib/staffAccounts'
import { clearLoginFailures, isLoginRateLimited, recordLoginFailure } from '@/lib/loginRateLimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COOKIE_OPTS = {
  httpOnly: true,   // JS からアクセス不可（XSS対策）
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7, // 7日間
}

function invalidLoginRequest() {
  return staffJson(
    { error: 'メールアドレスとパスワードを正しく入力してください' },
    { status: 400 }
  )
}

async function authenticateStaff(email: string, password: string): Promise<StaffUser | null> {
  const legacyUser = (): StaffUser | null => validateCredentials(email, password) ? {
    id: '',
    email,
    displayName: email,
    role: process.env.STAFF_ADMIN_EMAIL?.trim().toLowerCase() === email.trim().toLowerCase() ? 'admin' : 'staff',
    status: 'active',
    sessionVersion: 0,
    lastLoginAt: null,
  } : null

  if (!hasStaffDatabase()) {
    const local = await getLocalStaffUserByEmail(email)
    if (local && local.user.status === 'active' && await verifyStaffPassword(password, local.passwordHash)) return local.user
    return legacyUser()
  }

  try {
    const record = await getStaffUserByEmail(email)
    if (record) {
      if (record.user.status !== 'active') return null
      return await verifyStaffPassword(password, record.passwordHash) ? record.user : null
    }

    // 既存の環境変数アカウントを、最初のログイン時にハッシュ化してDBへ移行する。
    // STAFF_ADMIN_EMAILを設定したアカウントだけが移行後の管理者になる。
    if (!validateCredentials(email, password)) return null
    return ensureLegacyStaffUser(email, password)
  } catch (error) {
    // 開発環境では、DBが未起動でもローカル登録済みアカウント／環境変数アカウントを使える。
    // 本番ではDB障害を認証成功として扱わない。
    if (!canUseLocalStaffAuth()) throw error
    const local = await getLocalStaffUserByEmail(email)
    if (local && local.user.status === 'active' && await verifyStaffPassword(password, local.passwordHash)) return local.user
    return legacyUser()
  }
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
    if (process.env.NODE_ENV !== 'test' && isLoginRateLimited(email)) {
      return staffJson({ error: '試行回数が多すぎます。しばらく待ってから再度お試しください' }, { status: 429 })
    }
    const user = await authenticateStaff(email, password)
    if (!user) {
      if (process.env.NODE_ENV !== 'test') recordLoginFailure(email)
      return staffJson(
        { error: 'メールアドレスまたはパスワードが正しくありません' },
        { status: 401 }
      )
    }

    if (process.env.NODE_ENV !== 'test') clearLoginFailures(email)
    if (user.id) await touchStaffLogin(user.id)
    const token = user.id
      ? await createSessionToken(user.email, {
        userId: user.id,
        role: user.role,
        sessionVersion: user.sessionVersion,
      })
      : await createSessionToken(user.email, { role: user.role })
    const res = staffJson(user.id
      ? { ok: true, email: user.email, role: user.role }
      : { ok: true, email: user.email })
    res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTS)
    return res
  } catch (error) {
    // 認証設定・パスワード・JWTを応答やログへ含めない。
    if (error instanceof AuthConfigurationError || error instanceof SessionConfigurationError) {
      console.error('[auth] AUTH_CONFIGURATION_INVALID')
      return staffJson(
        { error: '現在ログインを利用できません。時間をおいて再度お試しください' },
        { status: 503 }
      )
    }
    console.error('[auth] AUTH_INTERNAL_ERROR')
    return staffJson(
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
    const payload = await resolveStaffToken(token)
    const response = staffJson({ user: payload })
    if (!payload) response.cookies.delete(SESSION_COOKIE)
    return response
  } catch {
    console.error('[GET /api/auth] AUTH_UNAVAILABLE')
    return staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  }
}

