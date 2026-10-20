/**
 * JWT セッション管理（jose ライブラリ使用）
 * Edge Runtime（middleware）でも動作する。
 */

import { SignJWT, jwtVerify } from 'jose'

const SESSION_COOKIE = 'odp_session'
const EXPIRY = '7d'

export type StaffRole = 'admin' | 'staff'

export type SessionPayload = {
  email: string
  userId?: string
  role?: StaffRole
  sessionVersion?: number
}

export class SessionConfigurationError extends Error {
  constructor() {
    super('SESSION_SECRET is not configured')
    this.name = 'SessionConfigurationError'
  }
}

export class AuthConfigurationError extends Error {
  constructor() {
    super('STAFF_CREDENTIALS に有効な認証情報が設定されていません')
    this.name = 'AuthConfigurationError'
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s?.trim()) throw new SessionConfigurationError()
  return new TextEncoder().encode(s)
}

/** JWT を生成してクッキー用の文字列を返す */
export async function createSessionToken(
  email: string,
  claims?: Omit<SessionPayload, 'email'>,
): Promise<string> {
  if (!isNonEmptyString(email)) throw new TypeError('セッションのメールアドレスが不正です')

  return new SignJWT({ email, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret())
}

/** JWT の署名・期限・利用者情報を検証する（無効なら null） */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  // Configuration errors are operational failures, not invalid user tokens.
  const secret = getSecret()
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'email'],
    })
    if (typeof payload.email !== 'string' || !payload.email.trim()) return null
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
    const result: SessionPayload = { email: payload.email }
    if (payload.userId !== undefined) {
      if (typeof payload.userId !== 'string' || !payload.userId.trim()) return null
      result.userId = payload.userId
    }
    if (payload.role !== undefined) {
      if (payload.role !== 'admin' && payload.role !== 'staff') return null
      result.role = payload.role
    }
    if (payload.sessionVersion !== undefined) {
      if (typeof payload.sessionVersion !== 'number' || !Number.isInteger(payload.sessionVersion) || payload.sessionVersion < 0) return null
      result.sessionVersion = payload.sessionVersion
    }
    if (result.userId && (result.role === undefined || result.sessionVersion === undefined)) return null
    return result
  } catch {
    return null
  }
}

/** スタッフ認証情報を検証する（有効な設定がなければ構成エラー） */
export function validateCredentials(email: unknown, password: unknown): boolean {
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) return false

  // 書式: "メール:パスワード|メール2:パスワード2"
  const users = (process.env.STAFF_CREDENTIALS ?? '').split('|').flatMap((entry) => {
    const separator = entry.indexOf(':')
    if (separator < 0) return []

    const configuredEmail = entry.slice(0, separator).trim()
    const configuredPassword = entry.slice(separator + 1).trim()
    if (!isNonEmptyString(configuredEmail) || !isNonEmptyString(configuredPassword)) return []

    return [{ email: configuredEmail, password: configuredPassword }]
  })

  if (users.length === 0) throw new AuthConfigurationError()
  return users.some((user) => user.email === email && user.password === password)
}

export { SESSION_COOKIE }

