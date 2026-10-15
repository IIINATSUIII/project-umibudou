import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from './session'

type StaffSession = { email: string }
type StaffAuthResult =
  | { ok: true; session: StaffSession }
  | { ok: false; response: NextResponse }

/** Staff responses must never be reused by a shared cache. */
export function staffJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers)
  headers.set('Cache-Control', 'no-store')
  return NextResponse.json(body, { ...init, headers })
}

/** Call in every staff handler before parsing input, reading data, or taking a lock. */
export async function requireStaffSession(req: NextRequest): Promise<StaffAuthResult> {
  if (!process.env.SESSION_SECRET?.trim()) {
    console.error('[staff-auth] AUTH_UNAVAILABLE')
    return { ok: false, response: staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 }) }
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      const session = await verifySessionToken(token)
      if (session) return { ok: true, session }
    } catch {
      console.error('[staff-auth] AUTH_UNAVAILABLE')
      return { ok: false, response: staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 }) }
    }
  }

  const response = staffJson({ error: 'Unauthorized' }, { status: 401 })
  if (token !== undefined) response.cookies.delete(SESSION_COOKIE)
  return { ok: false, response }
}
