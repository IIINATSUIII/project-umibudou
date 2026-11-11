import { NextRequest } from 'next/server'
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/session'
import { staffJson } from '@/lib/staffAuth'
import { consumeRegistrationAttempt, registrationClientKey } from '@/lib/registerRateLimit'
import { isAdminSetupCodeConfigured, verifyAdminSetupCode } from '@/lib/adminSetupCode'
import {
  AdminAlreadyExistsError,
  DuplicateStaffAccountError,
  hasActiveAdmin,
  hasStaffDatabase,
  isValidDisplayName,
  isValidStaffEmail,
  normalizeStaffEmail,
  registerInitialAdmin,
  registerStaffAccount,
  validateStaffPassword,
} from '@/lib/staffAccounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SETUP_REJECTED = '初期設定コードが正しくないか、管理者がすでに登録されています'

/**
 * GET /api/auth/register — 登録画面に「初期設定コード」欄を出すかどうか。
 * 有効な管理者が1人もおらず、ADMIN_SETUP_CODE が設定されている場合だけ true。
 */
export async function GET() {
  if (!hasStaffDatabase() || !isAdminSetupCodeConfigured()) return staffJson({ adminSetupAvailable: false })
  try {
    return staffJson({ adminSetupAvailable: !await hasActiveAdmin() })
  } catch {
    console.error('[GET /api/auth/register] AUTH_INTERNAL_ERROR')
    return staffJson({ adminSetupAvailable: false })
  }
}

/**
 * POST /api/auth/register — スタッフ登録申請。
 * 通常は staff 固定・承認待ち（suspended）で作成し、セッションCookieは発行しない。
 * 管理者が0人のときに正しい初期設定コードを添えた場合だけ、承認済みの管理者として作成してログインさせる。
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'test' && consumeRegistrationAttempt(registrationClientKey(req))) {
    return staffJson({ error: '登録の試行回数が多すぎます。しばらく待ってから再度お試しください' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch { return staffJson({ error: '入力形式が不正です' }, { status: 400 }) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return staffJson({ error: '入力形式が不正です' }, { status: 400 })
  }
  const input = body as Record<string, unknown>
  const email = typeof input.email === 'string' ? normalizeStaffEmail(input.email) : ''
  const displayName = typeof input.displayName === 'string' ? input.displayName : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const confirmation = typeof input.passwordConfirmation === 'string' ? input.passwordConfirmation : ''
  const setupCode = typeof input.setupCode === 'string' ? input.setupCode.trim() : ''
  if (!hasStaffDatabase()) return staffJson({ error: '現在アカウント登録を利用できません' }, { status: 503 })
  if (!isValidStaffEmail(email)) return staffJson({ error: 'メールアドレスを正しく入力してください' }, { status: 400 })
  if (!isValidDisplayName(displayName)) return staffJson({ error: '氏名を入力してください' }, { status: 400 })
  if (!validateStaffPassword(password)) return staffJson({ error: 'パスワードは5文字以上256文字以内で入力してください' }, { status: 400 })
  if (password !== confirmation) return staffJson({ error: 'パスワード確認が一致しません' }, { status: 400 })

  if (setupCode) return registerAdmin({ email, displayName, password, setupCode })

  const accepted = staffJson({ ok: true, pending: true }, { status: 202 })
  // 環境変数で移行する初期管理者のメールアドレスを先に登録され、管理者が作れなくなるのを防ぐ。
  // 外からは区別できないよう、通常の受付と同じ応答を返す。
  if (email === normalizeStaffEmail(process.env.STAFF_ADMIN_EMAIL ?? '')) return accepted
  try {
    await registerStaffAccount({ email, displayName, password })
    return accepted
  } catch (error) {
    // 登録済みかどうかを外部から調べられないよう、新規登録と同じ応答を返す。
    if (error instanceof DuplicateStaffAccountError) return accepted
    console.error('[POST /api/auth/register] AUTH_INTERNAL_ERROR')
    return staffJson({ error: 'アカウントを作成できませんでした' }, { status: 503 })
  }
}

async function registerAdmin(input: { email: string; displayName: string; password: string; setupCode: string }) {
  if (!verifyAdminSetupCode(input.setupCode)) return staffJson({ error: SETUP_REJECTED }, { status: 403 })
  try {
    const user = await registerInitialAdmin(input)
    const sessionToken = await createSessionToken(user.email, {
      userId: user.id,
      role: user.role,
      sessionVersion: user.sessionVersion,
    })
    const response = staffJson({ ok: true, admin: true }, { status: 201 })
    response.cookies.set(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS)
    return response
  } catch (error) {
    if (error instanceof AdminAlreadyExistsError) return staffJson({ error: SETUP_REJECTED }, { status: 403 })
    if (error instanceof DuplicateStaffAccountError) return staffJson({ error: 'このメールアドレスは既に登録されています' }, { status: 409 })
    console.error('[POST /api/auth/register] AUTH_INTERNAL_ERROR')
    return staffJson({ error: 'アカウントを作成できませんでした' }, { status: 503 })
  }
}
