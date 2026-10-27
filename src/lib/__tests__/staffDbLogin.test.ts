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
})
