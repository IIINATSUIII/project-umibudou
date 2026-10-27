import { NextRequest } from 'next/server'
import { createSessionToken, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/session'
import { staffJson } from '@/lib/staffAuth'
import { sendStaffRegistrationEmail } from '@/lib/staffEmail'
import {
  DuplicateStaffAccountError,
  hasStaffDatabase,
  InvalidInvitationError,
  isValidDisplayName,
  redeemStaffInvitation,
  validateStaffPassword,
} from '@/lib/staffAccounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getLoginUrl(req: NextRequest): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim()
  try {
    return new URL('/login', configuredBaseUrl || new URL(req.url).origin).toString()
  } catch {
    return new URL('/login', 'http://127.0.0.1:3030').toString()
  }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return staffJson({ error: '入力形式が不正です' }, { status: 400 }) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return staffJson({ error: '入力形式が不正です' }, { status: 400 })
  }
  const input = body as Record<string, unknown>
  const token = typeof input.token === 'string' ? input.token : ''
  const displayName = typeof input.displayName === 'string' ? input.displayName : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const confirmation = typeof input.passwordConfirmation === 'string' ? input.passwordConfirmation : ''
  if (!token) return staffJson({ error: 'スタッフ登録には管理者からの招待リンクが必要です' }, { status: 403 })
  if (!hasStaffDatabase()) return staffJson({ error: '現在アカウント登録を利用できません' }, { status: 503 })
  if (!isValidDisplayName(displayName)) return staffJson({ error: '氏名を入力してください' }, { status: 400 })
  if (!validateStaffPassword(password)) return staffJson({ error: 'パスワードは5文字以上256文字以内で入力してください' }, { status: 400 })
  if (password !== confirmation) return staffJson({ error: 'パスワード確認が一致しません' }, { status: 400 })

  try {
    const user = await redeemStaffInvitation({ token, displayName, password })
    const mail = await sendStaffRegistrationEmail({
      to: user.email,
      displayName: user.displayName,
      role: user.role,
      loginUrl: getLoginUrl(req),
    })
    if (!mail.sent) {
      console.warn(`[POST /api/auth/register] staff email was not sent: ${mail.reason}`)
    }
    const sessionToken = user.id
      ? await createSessionToken(user.email, {
        userId: user.id,
        role: user.role,
        sessionVersion: user.sessionVersion,
      })
      : await createSessionToken(user.email, { role: user.role })
    const response = staffJson({ ok: true, user: {
      email: user.email, displayName: user.displayName, role: user.role,
    }, mail }, { status: 201 })
    response.cookies.set(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS)
    return response
  } catch (error) {
    if (error instanceof InvalidInvitationError) return staffJson({ error: '招待リンクが無効または期限切れです' }, { status: 410 })
    if (error instanceof DuplicateStaffAccountError) return staffJson({ error: 'このメールアドレスは既に登録されています' }, { status: 409 })
    console.error('[POST /api/auth/register] AUTH_INTERNAL_ERROR')
    return staffJson({ error: 'アカウントを作成できませんでした' }, { status: 503 })
  }
}

