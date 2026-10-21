import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { createSessionToken, verifySessionToken, SESSION_COOKIE, SessionConfigurationError } from '../session'
import { requireStaffSession, staffJson } from '../staffAuth'
import { proxy as middleware } from '@/proxy'
import { GET as currentUser, POST as login, DELETE as logout } from '@/app/api/auth/route'

const secret = 'session-test-secret-never-use-in-production'
const staffEmail = 'staff@example.com'
function request(url = '/api/customers', token?: string) {
  return new NextRequest(`http://localhost${url}`, {
    headers: token === undefined ? {} : { cookie: `${SESSION_COOKIE}=${token}` },
  })
}
async function signed(payload: Record<string, unknown>, key = secret, algorithm = 'HS256') {
  return new SignJWT(payload).setProtectedHeader({ alg: algorithm }).sign(new TextEncoder().encode(key))
}
const expiry = () => Math.floor(Date.now() / 1000) + 3600

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', secret)
  vi.stubEnv('STAFF_CREDENTIALS', `${staffEmail}:test-password`)
  vi.stubEnv('STAFF_ADMIN_EMAIL', '')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('signed staff sessions', () => {
  it('accepts an issued seven-day session without changing the cookie or email', async () => {
    const token = await createSessionToken(staffEmail)
    expect(await verifySessionToken(token)).toEqual({ email: staffEmail })
    expect(await requireStaffSession(request(undefined, token))).toEqual({ ok: true, session: { email: staffEmail } })
  })

  it.each([
    { email: '', exp: 1 }, { email: '   ', exp: 1 }, { email: null, exp: 1 },
    { email: 123, exp: 1 }, { email: [], exp: 1 }, { email: {}, exp: 1 },
    { exp: 1 }, { email: staffEmail }, { email: staffEmail, exp: 'later' },
  ])('rejects missing or malformed required claims: %j', async (payload) => {
    const claims = { ...payload, ...('exp' in payload && payload.exp === 1 ? { exp: expiry() } : {}) }
    expect(await verifySessionToken(await signed(claims))).toBeNull()
  })

  it.each(['expired', 'different key', 'different algorithm', 'unsigned', 'corrupt'])(
    'rejects %s tokens and removes the unusable cookie', async (kind) => {
      const claims = { email: staffEmail, exp: kind === 'expired' ? 1 : expiry() }
      const token = kind === 'unsigned' ? 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUuY29tIn0.'
        : kind === 'corrupt' ? 'not.a.jwt'
        : await signed(claims, kind === 'different key' ? 'untrusted-key' : secret,
          kind === 'different algorithm' ? 'HS384' : 'HS256')
      const result = await requireStaffSession(request(undefined, token))
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Unexpected authorization')
      expect(result.response.status).toBe(401)
      expect(result.response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`)
      expect(result.response.headers.get('cache-control')).toBe('no-store')
    },
  )

  it.each(['', '   '])('distinguishes a missing signing key (%j) from an invalid session', async (value) => {
    vi.stubEnv('SESSION_SECRET', value)
    await expect(verifySessionToken('not.a.jwt')).rejects.toBeInstanceOf(SessionConfigurationError)
    const result = await requireStaffSession(request())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Unexpected authorization')
    expect(result.response.status).toBe(503)
    expect(await result.response.json()).toEqual({ error: 'AUTH_UNAVAILABLE' })
    expect(result.response.headers.get('set-cookie')).toBeNull()
  })

  it('does not emit a deletion cookie for an anonymous request', async () => {
    const result = await requireStaffSession(request())
    if (result.ok) throw new Error('Unexpected authorization')
    expect(result.response.status).toBe(401)
    expect(result.response.headers.get('set-cookie')).toBeNull()
  })

  it.each(['', '  '])('does not mint sessions without a staff identity: %j', async (email) => {
    await expect(createSessionToken(email)).rejects.toBeInstanceOf(TypeError)
  })
})

describe('page and API authentication boundaries', () => {
  it.each(['/api/customers', '/api/customers.png', '/api/roster', '/api/auth-extra', '/api/publicity', '/api/cron/sheets-outbox-extra'])(
    'returns JSON 401 for protected API %s', async (url) => {
      const response = await middleware(request(url))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
      expect(response.headers.get('location')).toBeNull()
    },
  )

  it.each(['/dashboard', '/customers', '/questionnaire/scan', '/questionnaire/scan/', '/questionnaire/scan/extra', '/booking-extra', '/line-menu-extra'])(
    'redirects anonymous page requests to login: %s', async (url) => {
      const response = await middleware(request(url))
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe('http://localhost/login')
    },
  )

  it.each(['/login', '/booking', '/line-menu/checkin', '/api/auth', '/api/public/bookings', '/api/public/questionnaires', '/api/public/checkin-qr', '/api/cron/sheets-outbox', '/questionnaire/opaque-token', '/_next/static/app.js', '/favicon.ico', '/line-rich-menu.png'])(
    'keeps public and independently authenticated paths available: %s', async (url) => {
      vi.stubEnv('SESSION_SECRET', '')
      expect((await middleware(request(url))).headers.get('x-middleware-next')).toBe('1')
    },
  )

  it('allows a valid session and never redirects on a configuration error', async () => {
    expect((await middleware(request('/dashboard', await createSessionToken(staffEmail)))).status).toBe(200)
    vi.stubEnv('SESSION_SECRET', '')
    expect((await middleware(request('/dashboard'))).status).toBe(503)
  })

  it('sets no-store while preserving supplied headers and status', () => {
    const response = staffJson({ ok: true }, { status: 201, headers: { 'X-Test': 'kept', 'Cache-Control': 'public' } })
    expect(response.status).toBe(201)
    expect(response.headers.get('x-test')).toBe('kept')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('authentication API uses the same validated sessions', () => {
  it.each([null, [], {}, { email: '' }, { email: staffEmail }, { email: staffEmail, password: '' },
    { email: staffEmail, password: 42 }, { email: 42, password: 'test-password' }])(
    'rejects invalid login input without issuing a cookie: %j', async (body) => {
      const response = await login(new NextRequest('http://localhost/api/auth', { method: 'POST', body: JSON.stringify(body) }))
      expect(response.status).toBe(400)
      expect(response.headers.get('set-cookie')).toBeNull()
    },
  )

  it('issues the existing HTTP-only cookie and resolves the current user', async () => {
    const response = await login(new NextRequest('http://localhost/api/auth', {
      method: 'POST', body: JSON.stringify({ email: staffEmail, password: 'test-password' }),
    }))
    expect(response.status).toBe(200)
    const cookie = response.cookies.get(SESSION_COOKIE)!.value
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax')
    expect(await (await currentUser(request('/api/auth', cookie))).json()).toEqual({
      user: { email: staffEmail, role: 'staff' },
    })
    expect((await logout()).headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`)
  })

  it('returns user:null for an invalid legacy identity, with no cached personal data', async () => {
    const token = await signed({ email: '', exp: expiry() })
    const response = await currentUser(request('/api/auth', token))
    expect(await response.json()).toEqual({ user: null })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('handles absent signing configuration without leaking errors or issuing a cookie', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    const response = await login(new NextRequest('http://localhost/api/auth', {
      method: 'POST', body: JSON.stringify({ email: staffEmail, password: 'test-password' }),
    }))
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
