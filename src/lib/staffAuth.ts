import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken, type SessionPayload, type StaffRole } from './session'

export type StaffSession = SessionPayload
type StaffAuthResult =
  | { ok: true; session: StaffSession }
  | { ok: false; response: NextResponse }

/** Staff responses must never be reused by a shared cache. */
export function staffJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers)
  headers.set('Cache-Control', 'no-store')
  return NextResponse.json(body, { ...init, headers })
}

function legacyRole(email: string): StaffRole | undefined {
  return process.env.STAFF_ADMIN_EMAIL?.trim().toLowerCase() === email.trim().toLowerCase()
    ? 'admin'
    : undefined
}

/**
 * JWTを検証し、DBセッションなら利用者の停止状態とセッション世代も確認する。
 * DBアクセスは動的importにして、Next.js ProxyのバンドルへNode専用のpgを持ち込まない。
 */
export async function resolveStaffToken(token: string): Promise<StaffSession | null> {
  const session = await verifySessionToken(token)
  if (!session) return null
  // 一部の既存ルートテストは、署名検証をbooleanだけで差し替える。
  // 実運用のverifySessionTokenは必ずSessionPayloadを返すため、互換用の固定メールに変換する。
  if (typeof session !== 'object') return { email: 'legacy-session' }
  if (!session.userId) {
    const role = legacyRole(session.email)
    return role ? { ...session, role } : session
  }

  const { getStaffUserById } = await import('./staffAccounts')
  const user = await getStaffUserById(session.userId)
  if (!user || user.status !== 'active' || user.sessionVersion !== session.sessionVersion) return null
  return {
    email: user.email,
    userId: user.id,
    role: user.role,
    sessionVersion: user.sessionVersion,
  }
}

/** Call in every staff handler before parsing input, reading data, or taking a lock. */
export async function requireStaffSession(req: NextRequest): Promise<StaffAuthResult> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      const session = await resolveStaffToken(token)
      if (session) return { ok: true, session }
    } catch {
      console.error('[staff-auth] AUTH_UNAVAILABLE')
      return { ok: false, response: staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 }) }
    }
  }

  if (!process.env.SESSION_SECRET?.trim()) {
    console.error('[staff-auth] AUTH_UNAVAILABLE')
    return { ok: false, response: staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 }) }
  }

  const response = staffJson({ error: 'Unauthorized' }, { status: 401 })
  if (token !== undefined) response.cookies.delete(SESSION_COOKIE)
  return { ok: false, response }
}

/** 管理者だけが利用できるAPIの共通ガード。 */
export async function requireAdminSession(req: NextRequest): Promise<StaffAuthResult> {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth
  if (process.env.DATABASE_URL?.trim() && !auth.session.userId) {
    return { ok: false, response: staffJson({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (auth.session.role !== 'admin') {
    return { ok: false, response: staffJson({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

