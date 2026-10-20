import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendStaffRegistrationEmail } from '../staffEmail'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('スタッフ登録完了メール', () => {
  it('送信設定がない場合は外部APIを呼ばず未送信を返す', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(sendStaffRegistrationEmail({
      to: 'staff@example.com',
      displayName: 'テストスタッフ',
      role: 'staff',
      loginUrl: 'http://127.0.0.1:3030/login',
    })).resolves.toEqual({ sent: false, reason: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Resendへ登録したメールアドレスを宛先として送信する', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EMAIL_FROM', '沖ダイブ・パートナー <noreply@example.com>')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }),
    )

    await expect(sendStaffRegistrationEmail({
      to: 'staff@example.com',
      displayName: 'テストスタッフ',
      role: 'staff',
      loginUrl: 'https://example.com/login',
    })).resolves.toEqual({ sent: true, provider: 'resend' })

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('staff@example.com'),
    }))
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body)) as { to: string[]; text: string; html: string }
    expect(body.to).toEqual(['staff@example.com'])
    expect(body.text).toContain('https://example.com/login')
    expect(body.html).toContain('テストスタッフ')
    expect(body.text).not.toContain('password')
  })

  it('Resendの失敗時は未送信として返す', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('EMAIL_FROM', 'noreply@example.com')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad request', { status: 400 }))

    await expect(sendStaffRegistrationEmail({
      to: 'staff@example.com',
      displayName: 'テストスタッフ',
      role: 'staff',
      loginUrl: 'https://example.com/login',
    })).resolves.toEqual({ sent: false, reason: 'send_failed' })
  })
})


