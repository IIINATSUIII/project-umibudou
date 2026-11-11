import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const deps = vi.hoisted(() => ({
  registerStaffAccount: vi.fn(),
  updateStaffUser: vi.fn(),
  hasStaffDatabase: vi.fn(() => true),
  sendStaffApprovalEmail: vi.fn(),
}))

vi.mock('@/lib/staffAccounts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/staffAccounts')>(),
  registerStaffAccount: deps.registerStaffAccount,
  updateStaffUser: deps.updateStaffUser,
  hasStaffDatabase: deps.hasStaffDatabase,
}))
vi.mock('@/lib/staffEmail', () => ({ sendStaffApprovalEmail: deps.sendStaffApprovalEmail }))
vi.mock('@/lib/staffAuth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/staffAuth')>(),
  requireAdminSession: vi.fn(async () => ({ ok: true, session: { email: 'admin@example.com', role: 'admin', userId: 'STU-admin' } })),
}))

import { POST as register } from '@/app/api/auth/register/route'
import { PATCH as updateStaff } from '@/app/api/auth/staff/route'
import { DuplicateStaffAccountError } from '@/lib/staffAccounts'
import { consumeRegistrationAttempt, resetRegistrationAttempts } from '@/lib/registerRateLimit'

const validBody = {
  email: ' New.Staff@Example.com ',
  displayName: '新人スタッフ',
  password: 'secret-pass',
  passwordConfirmation: 'secret-pass',
}

function registerRequest(body: unknown) {
  return register(new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function patchRequest(body: unknown) {
  return updateStaff(new NextRequest('http://localhost/api/auth/staff', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  deps.registerStaffAccount.mockReset().mockResolvedValue({
    id: 'STU-1', email: 'new.staff@example.com', displayName: '新人スタッフ',
    role: 'staff', status: 'suspended', sessionVersion: 0, lastLoginAt: null,
  })
  deps.updateStaffUser.mockReset()
  deps.hasStaffDatabase.mockReset().mockReturnValue(true)
  deps.sendStaffApprovalEmail.mockReset().mockResolvedValue({ sent: true, provider: 'resend' })
})

afterEach(() => resetRegistrationAttempts())

describe('招待なしのスタッフ登録', () => {
  it('招待トークンなしで登録を受け付け、ログイン状態にはしない', async () => {
    const response = await registerRequest(validBody)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, pending: true })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(deps.registerStaffAccount).toHaveBeenCalledWith({
      email: 'new.staff@example.com', displayName: '新人スタッフ', password: 'secret-pass',
    })
  })

  it('権限を送ってきても登録処理へ渡さない（staff固定）', async () => {
    await registerRequest({ ...validBody, role: 'admin', status: 'active' })

    const input = deps.registerStaffAccount.mock.calls[0]?.[0] as Record<string, unknown>
    expect(Object.keys(input).sort()).toEqual(['displayName', 'email', 'password'])
  })

  it('登録済みのメールアドレスでも新規登録と同じ応答を返す', async () => {
    deps.registerStaffAccount.mockRejectedValue(new DuplicateStaffAccountError())

    const response = await registerRequest(validBody)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, pending: true })
  })

  it.each([
    [{ ...validBody, email: 'not-an-email' }, 'メールアドレス'],
    [{ ...validBody, displayName: '  ' }, '氏名'],
    [{ ...validBody, password: '1234', passwordConfirmation: '1234' }, 'パスワード'],
    [{ ...validBody, passwordConfirmation: 'different' }, 'パスワード確認'],
  ])('入力が不正なら400を返し、登録しない', async (body, message) => {
    const response = await registerRequest(body)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain(message)
    expect(deps.registerStaffAccount).not.toHaveBeenCalled()
  })

  it('DBが未設定なら503を返す', async () => {
    deps.hasStaffDatabase.mockReturnValue(false)

    const response = await registerRequest(validBody)

    expect(response.status).toBe(503)
    expect(deps.registerStaffAccount).not.toHaveBeenCalled()
  })
})

describe('登録の試行回数制限', () => {
  it('同じ送信元から1時間に5回を超える登録を拒否し、時間が経てば戻る', () => {
    const now = 1_000_000
    for (let i = 0; i < 5; i += 1) expect(consumeRegistrationAttempt('203.0.113.1', now)).toBe(false)
    expect(consumeRegistrationAttempt('203.0.113.1', now)).toBe(true)
    expect(consumeRegistrationAttempt('203.0.113.2', now)).toBe(false)
    expect(consumeRegistrationAttempt('203.0.113.1', now + 60 * 60 * 1000)).toBe(false)
  })
})

describe('管理者による承認', () => {
  const approvedStaff = {
    id: 'STU-1', email: 'new.staff@example.com', displayName: '新人スタッフ',
    role: 'staff', status: 'active', sessionVersion: 1, lastLoginAt: null,
  }

  it('承認したときだけ本人へ承認メールを送る', async () => {
    deps.updateStaffUser.mockResolvedValue({ staff: approvedStaff, approved: true })

    const response = await patchRequest({ id: 'STU-1', status: 'active' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ approved: true, mail: { sent: true } })
    expect(deps.sendStaffApprovalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new.staff@example.com', role: 'staff',
    }))
  })

  it('承認以外の更新ではメールを送らない', async () => {
    deps.updateStaffUser.mockResolvedValue({ staff: { ...approvedStaff, role: 'admin' }, approved: false })

    const response = await patchRequest({ id: 'STU-1', role: 'admin' })

    expect(response.status).toBe(200)
    expect(deps.sendStaffApprovalEmail).not.toHaveBeenCalled()
  })
})
