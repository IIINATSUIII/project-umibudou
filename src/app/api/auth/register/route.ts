import { NextRequest } from 'next/server'
import { staffJson } from '@/lib/staffAuth'
import { consumeRegistrationAttempt, registrationClientKey } from '@/lib/registerRateLimit'
import {
  DuplicateStaffAccountError,
  hasStaffDatabase,
  isValidDisplayName,
  isValidStaffEmail,
  normalizeStaffEmail,
  registerStaffAccount,
  validateStaffPassword,
} from '@/lib/staffAccounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/auth/register — 招待なしのスタッフ登録申請。
 * 権限は staff 固定、管理者が承認するまでログインできない（status: suspended）。
 * 承認前なのでセッションCookieは発行しない。
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
  if (!hasStaffDatabase()) return staffJson({ error: '現在アカウント登録を利用できません' }, { status: 503 })
  if (!isValidStaffEmail(email)) return staffJson({ error: 'メールアドレスを正しく入力してください' }, { status: 400 })
  if (!isValidDisplayName(displayName)) return staffJson({ error: '氏名を入力してください' }, { status: 400 })
  if (!validateStaffPassword(password)) return staffJson({ error: 'パスワードは5文字以上256文字以内で入力してください' }, { status: 400 })
  if (password !== confirmation) return staffJson({ error: 'パスワード確認が一致しません' }, { status: 400 })

  const accepted = staffJson({ ok: true, pending: true }, { status: 202 })
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
