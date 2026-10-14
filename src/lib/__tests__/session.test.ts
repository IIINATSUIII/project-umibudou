import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { SessionConfigurationError, createSessionToken, validateCredentials, verifySessionToken } from '../session'

const EMAIL = 'staff@example.com'
const PASSWORD = 'fixture-password'
const SECRET = 'issue-56-test-signing-key-not-for-production'
const invalidValues: unknown[] = [undefined, null, 0, false, [], {}, '', ' \t\n']
const invalidSettings = [undefined, '', '   ', '|', '||', 'broken', ':password', EMAIL + ':', EMAIL + ':   ']

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', SECRET)
  vi.stubEnv('STAFF_CREDENTIALS', EMAIL + ':' + PASSWORD)
})
afterEach(() => vi.unstubAllEnvs())

describe('スタッフ認証の入力と設定', () => {
  it.each(invalidValues)('メールが非空文字列でなければ拒否する: %j', (value) => {
    expect(validateCredentials(value as string, PASSWORD)).toBe(false)
  })
  it.each(invalidValues)('パスワードが非空文字列でなければ拒否する: %j', (value) => {
    expect(validateCredentials(EMAIL, value as string)).toBe(false)
  })
  it.each(invalidSettings)('有効な設定がなければ構成エラーにする: %j', (raw) => {
    vi.stubEnv('STAFF_CREDENTIALS', raw)
    expect(() => validateCredentials(EMAIL, PASSWORD)).toThrow()
  })
  it.each([undefined, '', '   ', EMAIL + ':' + PASSWORD + '|', '|' + EMAIL + ':' + PASSWORD, '||'])(
    '空エントリとパスワード省略で認証できない: %j',
    (raw) => {
      vi.stubEnv('STAFF_CREDENTIALS', raw)
      expect(validateCredentials('', undefined as unknown as string)).toBe(false)
    }
  )
  it('複数スタッフと空・不正エントリの混在でも有効な組だけで照合する', () => {
    vi.stubEnv('STAFF_CREDENTIALS', '||broken|:password|ghost@example.com:|  ' + EMAIL + ' : ' + PASSWORD + '  |second@example.com:second-password||')
    expect(validateCredentials(EMAIL, PASSWORD)).toBe(true)
    expect(validateCredentials('second@example.com', 'second-password')).toBe(true)
    expect(validateCredentials('ghost@example.com', '')).toBe(false)
    expect(validateCredentials('', 'password')).toBe(false)
  })
  it('パスワードのコロン以降も含めて照合する', () => {
    vi.stubEnv('STAFF_CREDENTIALS', EMAIL + ':fixture:password')
    expect(validateCredentials(EMAIL, 'fixture:password')).toBe(true)
    expect(validateCredentials(EMAIL, 'fixture')).toBe(false)
  })
  it('誤った資格情報や加工したパスワードは受理しない', () => {
    expect(validateCredentials(EMAIL, 'wrong')).toBe(false)
    expect(validateCredentials('unknown@example.com', PASSWORD)).toBe(false)
    expect(validateCredentials(EMAIL, ' ' + PASSWORD)).toBe(false)
    expect(validateCredentials(EMAIL, PASSWORD + ' ')).toBe(false)
    expect(validateCredentials('Staff@example.com', PASSWORD)).toBe(false)
  })
})

describe('JWTの利用者情報', () => {
  it('正しいメールのセッションを発行・検証できる', async () => {
    const token = await createSessionToken(EMAIL)
    expect(await verifySessionToken(token)).toEqual({ email: EMAIL })
  })
  it.each(invalidValues)('不正なメールでセッションを発行しない: %j', async (value) => {
    await expect(createSessionToken(value as string)).rejects.toThrow()
  })
  it.each([{}, { email: '' }, { email: '   ' }, { email: null }, { email: 1 }, { email: false }, { email: [] }, { email: {} }])(
    '署名済みでも不正なメールの既存JWTを拒否する: %j',
    async (claims) => {
      const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d')
        .sign(new TextEncoder().encode(SECRET))
      await expect(verifySessionToken(token)).rejects.toBeInstanceOf(SessionConfigurationError)
    }
  )
  it('期限切れ・異なる署名・不正形式も拒否する', async () => {
    const expired = await new SignJWT({ email: EMAIL }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(0)
      .sign(new TextEncoder().encode(SECRET))
    const wrongKey = await new SignJWT({ email: EMAIL }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d')
      .sign(new TextEncoder().encode('different-fixture-key'))
    expect(await verifySessionToken(expired)).toBeNull()
    expect(await verifySessionToken(wrongKey)).toBeNull()
    expect(await verifySessionToken('not-a-jwt')).toBeNull()
  })
  it('署名鍵未設定時は発行を拒否し、検証も成立しない', async () => {
    const token = await createSessionToken(EMAIL)
    vi.stubEnv('SESSION_SECRET', undefined)
    await expect(createSessionToken(EMAIL)).rejects.toThrow()
    await expect(verifySessionToken(token)).rejects.toBeInstanceOf(SessionConfigurationError)
  })
})
