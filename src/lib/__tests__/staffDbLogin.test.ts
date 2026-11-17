import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const staff = vi.hoisted(() => ({
  getStaffUserByEmail: vi.fn(),
  verifyStaffPassword: vi.fn(),
  ensureLegacyStaffUser: vi.fn(),
}))

vi.mock('@/lib/staffAccounts', () => ({
  canUseLocalStaffAuth: () => false,
  getStaffUserByEmail: staff.getStaffUserByEmail,
  hasStaffDatabase: () => true,
  ensureLegacyStaffUser: staff.ensureLegacyStaffUser,
  getLocalStaffUserByEmail: vi.fn(),
  touchStaffLogin: vi.fn(),
  verifyStaffPassword: staff.verifyStaffPassword,
}))

import { POST } from '@/app/api/auth/route'

function login(email: string) {
  return POST(new NextRequest('http://localhost/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'incorrect-password' }),
  }))
}

describe('DB-managed staff login without legacy credentials', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_CREDENTIALS', '')
    staff.getStaffUserByEmail.mockReset()
    staff.verifyStaffPassword.mockReset().mockResolvedValue(false)
    staff.ensureLegacyStaffUser.mockReset()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('returns the same authentication failure for unknown and existing emails', async () => {
    staff.getStaffUserByEmail.mockImplementation(async (email: string) => email === 'known@example.com'
      ? { user: { status: 'active' }, passwordHash: 'stored-hash' }
      : null)

    const unknown = await login('unknown@example.com')
    const known = await login('known@example.com')

    expect(unknown.status).toBe(401)
    expect(known.status).toBe(401)
    expect(await unknown.json()).toEqual(await known.json())
    expect(staff.ensureLegacyStaffUser).not.toHaveBeenCalled()
  })

  it('承認待ちのアカウントは正しいパスワードでもログインできず、承認待ちと案内する', async () => {
    staff.getStaffUserByEmail.mockResolvedValue({
      user: { id: 'STU-1', email: 'pending@example.com', role: 'staff', status: 'suspended', sessionVersion: 0, lastLoginAt: null },
      passwordHash: 'stored-hash',
    })
    staff.verifyStaffPassword.mockResolvedValue(true)

    const response = await login('pending@example.com')

    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('承認待ち')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('承認待ちのアカウントでもパスワードが違えば、未登録と同じ401を返す', async () => {
    staff.getStaffUserByEmail.mockImplementation(async (email: string) => email === 'pending@example.com'
      ? { user: { status: 'suspended' }, passwordHash: 'stored-hash' }
      : null)

    const pending = await login('pending@example.com')
    const unknown = await login('unknown@example.com')

    expect(pending.status).toBe(401)
    expect(await pending.json()).toEqual(await unknown.json())
  })
})
