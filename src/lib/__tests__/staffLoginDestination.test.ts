import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { staffLoginDestination, staffLoginUrl } from '../staffLoginDestination'

vi.mock('@/lib/session', () => ({ SESSION_COOKIE: 'odp_session', verifySessionToken: async () => null }))
import { proxy } from '@/proxy'

afterEach(() => vi.unstubAllEnvs())

it.each(['/checkin/mobile', '/questionnaire/scan'])('returns to staff reception %s after login', async path => {
  vi.stubEnv('SESSION_SECRET', 'test-only')
  expect(staffLoginDestination(path)).toBe(path)
  for (const cookie of ['', 'odp_session=expired']) {
    const response = await proxy(new NextRequest(`https://shop.example${path}`, { headers: { cookie } }))
    expect(response.headers.get('location')).toBe(`https://shop.example${staffLoginUrl(path)}`)
  }
})

it.each([null, 'https://other.example', '//other.example', '/\\other.example', 'javascript:alert(1)', '/api/setup', '/checkin/mobile?token=private', '/questionnaire/scan?token=private'])('rejects unapproved login destinations: %s', value => {
  expect(staffLoginDestination(value)).toBe('/dashboard')
})

it('does not forward query credentials to the login URL', async () => {
  vi.stubEnv('SESSION_SECRET', 'test-only')
  const response = await proxy(new NextRequest('https://shop.example/questionnaire/scan?token=private'))
  expect(response.headers.get('location')).toBe('https://shop.example/login?next=%2Fquestionnaire%2Fscan')
})
