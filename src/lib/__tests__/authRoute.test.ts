import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import * as session from '../session'
import { DELETE, GET, POST } from '../../app/api/auth/route'
import { middleware } from '../../middleware'

const EMAIL = 'staff@example.com'
const PASSWORD = 'fixture-password'
const SECRET = 'issue-56-test-signing-key-not-for-production'
const VALID_BODY = { email: EMAIL, password: PASSWORD }
const badBodies: unknown[] = [
  null, [], 'text', 1, false, {},
  { email: EMAIL }, { password: PASSWORD },
  ...[undefined, null, 0, false, [], {}, '', ' \t\n'].flatMap((value) => [
    { email: value, password: PASSWORD }, { email: EMAIL, password: value },
  ]),
]
const invalidSettings = [undefined, '', '   ', '|', '||', 'broken', ':password', EMAIL + ':']

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}
function cookieRequest(path: string, token?: string) {
  return new NextRequest('http://localhost' + path, {
    headers: token ? { cookie: session.SESSION_COOKIE + '=' + token } : {},
  })
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', SECRET)
  vi.stubEnv('STAFF_CREDENTIALS', EMAIL + ':' + PASSWORD)
  vi.spyOn(session, 'createSessionToken')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('POST /api/auth', () => {
  it.each(badBodies)('不正入力を400で拒否しJWTを発行しない: %j', async (body) => {
    const response = await POST(postRequest(body))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toEqual(expect.any(String))
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(session.createSessionToken).not.toHaveBeenCalled()
  })
  it.each(['{', '', '{"email":'])('不正JSONを400で拒否する: %j', async (body) => {
    const request = new NextRequest('http://localhost/api/auth', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toEqual(expect.any(String))
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(session.createSessionToken).not.toHaveBeenCalled()
  })
  it.each(invalidSettings)('設定不備を503で拒否しJWTを発行しない: %j', async (raw) => {
    vi.stubEnv('STAFF_CREDENTIALS', raw)
    const response = await POST(postRequest(VALID_BODY))
    expect(response.status).toBe(503)
    expect((await response.json()).error).toEqual(expect.any(String))
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(session.createSessionToken).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(PASSWORD)
  })
  it('末尾区切りを悪用した空メールとパスワード省略を拒否する', async () => {
    vi.stubEnv('STAFF_CREDENTIALS', EMAIL + ':' + PASSWORD + '|')
    const response = await POST(postRequest({ email: '' }))
    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(session.createSessionToken).not.toHaveBeenCalled()
  })
  it('未登録メールとパスワード不一致には同じ401応答を返す', async () => {
    const unknown = await POST(postRequest({ email: 'unknown@example.com', password: PASSWORD }))
    const wrong = await POST(postRequest({ email: EMAIL, password: 'wrong' }))
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
    expect(unknown.headers.get('set-cookie')).toBeNull()
    expect(wrong.headers.get('set-cookie')).toBeNull()
    expect(session.createSessionToken).not.toHaveBeenCalled()
  })
  it('実際の照合でログインし有効なHTTP-onlyセッションを発行する', async () => {
    vi.stubEnv('STAFF_CREDENTIALS', '|broken|' + EMAIL + ':' + PASSWORD + '||')
    const response = await POST(postRequest(VALID_BODY))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, email: EMAIL })
    expect(session.createSessionToken).toHaveBeenCalledTimes(1)
    expect(session.createSessionToken).toHaveBeenCalledWith(EMAIL)
    const cookie = response.cookies.get(session.SESSION_COOKIE)
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 604800 })
    expect(await session.verifySessionToken(cookie!.value)).toEqual({ email: EMAIL })
  })
  it('本番のセッションCookieにSecureを設定する', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { POST: productionPOST } = await import('../../app/api/auth/route')
    const response = await productionPOST(postRequest(VALID_BODY))
    expect(response.cookies.get(session.SESSION_COOKIE)?.secure).toBe(true)
  })
  it('内部エラーの秘密値を応答・ログへ出さず500で返す', async () => {
    vi.mocked(session.createSessionToken).mockRejectedValueOnce(new Error(SECRET + ' ' + PASSWORD))
    const response = await POST(postRequest(VALID_BODY))
    expect(response.status).toBe(500)
    expect((await response.json()).error).toEqual(expect.any(String))
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(PASSWORD)
  })
  it('署名鍵が欠落しても成功やCookie発行にならない', async () => {
    vi.stubEnv('SESSION_SECRET', undefined)
    const response = await POST(postRequest(VALID_BODY))
    expect(response.status).toBe(503)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect((await response.json()).error).toEqual(expect.any(String))
  })
})

describe('GET /api/auth と保護画面・ログアウト', () => {
  it('ログイン後のユーザー取得・保護画面表示とログアウトが成立する', async () => {
    const login = await POST(postRequest(VALID_BODY))
    const token = login.cookies.get(session.SESSION_COOKIE)!.value
    const current = await GET(cookieRequest('/api/auth', token))
    expect(await current.json()).toEqual({ user: { email: EMAIL } })
    const access = await middleware(cookieRequest('/dashboard', token))
    expect(access.headers.get('x-middleware-next')).toBe('1')
    const logout = await DELETE()
    expect(await logout.json()).toEqual({ ok: true })
    expect(logout.cookies.get(session.SESSION_COOKIE)?.value).toBe('')
    expect(logout.cookies.get(session.SESSION_COOKIE)?.expires).toEqual(new Date(0))
  })
  it('修正前に発行された空メールの署名済みJWTを保護画面で拒否する', async () => {
    const token = await new SignJWT({ email: '' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d')
      .sign(new TextEncoder().encode(SECRET))
    const current = await GET(cookieRequest('/api/auth', token))
    expect(await current.json()).toEqual({ user: null })
    const access = await middleware(cookieRequest('/dashboard', token))
    expect(access.headers.get('location')).toBe('http://localhost/login')
    expect(access.headers.get('x-middleware-next')).toBeNull()
    expect(access.cookies.get(session.SESSION_COOKIE)?.value).toBe('')
  })
  it('Cookieがなければ未ログインとして扱う', async () => {
    expect(await (await GET(cookieRequest('/api/auth'))).json()).toEqual({ user: null })
    const access = await middleware(cookieRequest('/dashboard'))
    expect(access.headers.get('location')).toBe('http://localhost/login')
  })
})
