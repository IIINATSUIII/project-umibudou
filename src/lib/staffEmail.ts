export type StaffRegistrationEmailResult =
  | { sent: true; provider: 'resend' }
  | { sent: false; reason: 'not_configured' | 'send_failed' }

type StaffRegistrationEmailInput = {
  to: string
  displayName: string
  role: 'admin' | 'staff'
  loginUrl: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function roleLabel(role: StaffRegistrationEmailInput['role']): string {
  return role === 'admin' ? '管理者' : 'スタッフ'
}

/**
 * Resend経由でスタッフ登録完了メールを送信する。
 * パスワードや招待トークンはメールに含めない。
 */
export async function sendStaffRegistrationEmail(
  input: StaffRegistrationEmailInput,
): Promise<StaffRegistrationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.EMAIL_FROM?.trim()
  if (!apiKey || !from) return { sent: false, reason: 'not_configured' }

  const safeName = escapeHtml(input.displayName)
  const safeEmail = escapeHtml(input.to)
  const safeLoginUrl = escapeHtml(input.loginUrl)
  const safeRole = escapeHtml(roleLabel(input.role))
  const text = [
    `${input.displayName} 様`,
    '',
    '沖ダイブ・パートナーのスタッフアカウントが作成されました。',
    `登録メールアドレス: ${input.to}`,
    `権限: ${roleLabel(input.role)}`,
    '',
    `ログイン: ${input.loginUrl}`,
    '',
    'このメールにパスワードは記載していません。',
    '心当たりがない場合は管理者へ連絡してください。',
  ].join('\n')
  const html = `
    <p>${safeName} 様</p>
    <p>沖ダイブ・パートナーのスタッフアカウントが作成されました。</p>
    <p>登録メールアドレス: ${safeEmail}</p>
    <p>権限: ${safeRole}</p>
    <p><a href="${safeLoginUrl}">ログイン画面を開く</a></p>
    <p>このメールにパスワードは記載していません。心当たりがない場合は管理者へ連絡してください。</p>
  `

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: 'スタッフアカウントが作成されました',
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      console.error('[staff email] provider rejected message', { status: response.status })
      return { sent: false, reason: 'send_failed' }
    }
    return { sent: true, provider: 'resend' }
  } catch (error) {
    console.error('[staff email] provider request failed', error instanceof Error ? error.message : 'unknown error')
    return { sent: false, reason: 'send_failed' }
  }
}


