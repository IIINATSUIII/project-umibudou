/**
 * JWT セッション管理（jose ライブラリ使用）
 * Edge Runtime（middleware）でも動作する。
 */

import { SignJWT, jwtVerify } from 'jose'

const SESSION_COOKIE = 'odp_session'
const EXPIRY = '7d'

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET が設定されていません')
  return new TextEncoder().encode(s)
}

/** JWT を生成してクッキー用の文字列を返す */
export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret())
}

/** JWT を検証してペイロードを返す（無効なら null） */
export async function verifySessionToken(
  token: string
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return { email: payload.email as string }
  } catch {
    return null
  }
}

/** スタッフ認証情報を検証する（.env.local の STAFF_CREDENTIALS を参照） */
export function validateCredentials(email: string, password: string): boolean {
  // 書式: "staff@okidive.com:pass1|staff2@okidive.com:pass2"
  const raw = process.env.STAFF_CREDENTIALS ?? ''
  const users = raw.split('|').map((u) => {
    const [e, p] = u.split(':')
    return { email: e?.trim(), password: p?.trim() }
  })
  return users.some((u) => u.email === email && u.password === password)
}

export { SESSION_COOKIE }
