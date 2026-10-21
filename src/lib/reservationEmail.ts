import type { ReservationEmail } from '@/types'

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

const TIME_SLOT_LABELS: Record<ReservationEmail['timeSlot'], string> = {
  morning: '午前',
  afternoon: '午後',
  full: '1日',
  unspecified: '指定なし',
}

export class EmailConfigurationError extends Error {
  constructor() {
    super('予約受付メールの送信設定がありません')
    this.name = 'EmailConfigurationError'
  }
}

export class EmailDeliveryError extends Error {
  readonly status: number

  constructor(status: number) {
    super('予約受付メールの送信に失敗しました')
    this.name = 'EmailDeliveryError'
    this.status = status
  }
}

export function isReservationEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character)
}

export function timeSlotLabel(timeSlot: ReservationEmail['timeSlot']): string {
  return TIME_SLOT_LABELS[timeSlot]
}

export function buildReservationReceiptEmail(email: ReservationEmail): {
  subject: string
  text: string
  html: string
} {
  const time = timeSlotLabel(email.timeSlot)
  const subject = `【海ぶどうギャング】予約受付完了（仮予約） ${email.reservationId}`
  const text = [
    `${email.guestName} 様`,
    '',
    'ダイビングのお申し込みを受け付けました。',
    'このメールは受付完了のお知らせであり、予約確定の通知ではありません。',
    'スタッフが内容を確認した後、お電話にて予約確定のご連絡をいたします。',
    '',
    `予約ID: ${email.reservationId}`,
    `希望日: ${email.diveDate}`,
    `希望時間帯: ${time}`,
    `コース: ${email.courseName}`,
    `人数: ${email.guestCount}名`,
    '',
    '内容に誤りがある場合やご不明な点がある場合は、店舗までお問い合わせください。',
  ].join('\n')
  const html = [
    `<p>${escapeHtml(email.guestName)} 様</p>`,
    '<p>ダイビングのお申し込みを受け付けました。</p>',
    '<p><strong>このメールは受付完了のお知らせであり、予約確定の通知ではありません。</strong><br>スタッフが内容を確認した後、お電話にて予約確定のご連絡をいたします。</p>',
    '<table><tbody>',
    `<tr><th align="left">予約ID</th><td>${escapeHtml(email.reservationId)}</td></tr>`,
    `<tr><th align="left">希望日</th><td>${escapeHtml(email.diveDate)}</td></tr>`,
    `<tr><th align="left">希望時間帯</th><td>${escapeHtml(time)}</td></tr>`,
    `<tr><th align="left">コース</th><td>${escapeHtml(email.courseName)}</td></tr>`,
    `<tr><th align="left">人数</th><td>${email.guestCount}名</td></tr>`,
    '</tbody></table>',
    '<p>内容に誤りがある場合やご不明な点がある場合は、店舗までお問い合わせください。</p>',
  ].join('')
  return { subject, text, html }
}

export async function sendReservationReceiptEmail(email: ReservationEmail): Promise<string> {
  if (!isReservationEmailConfigured()) throw new EmailConfigurationError()
  const content = buildReservationReceiptEmail(email)
  const response = await fetch(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // The reservation ID identifies one immutable receipt email across retries.
      'Idempotency-Key': `reservation-received/${email.reservationId}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [email.recipientEmail],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  })
  if (!response.ok) throw new EmailDeliveryError(response.status)
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof (body as { id?: unknown }).id !== 'string')
    throw new EmailDeliveryError(response.status)
  return (body as { id: string }).id
}
