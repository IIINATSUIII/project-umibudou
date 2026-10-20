import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildReservationReceiptEmail,
  sendReservationReceiptEmail,
} from '../reservationEmail'
import type { ReservationEmail } from '@/types'

const email: ReservationEmail = {
  id: 'RE-R-20261020-abc',
  reservationId: 'R-20261020-abc',
  requestKey: 'request-1',
  recipientEmail: 'guest@example.com',
  guestName: '<山田>',
  diveDate: '2026-10-21',
  timeSlot: 'morning',
  courseId: 'CRS-001',
  courseName: '体験ダイビング',
  guestCount: 2,
  status: 'pending',
  attemptCount: 0,
  availableAt: '2026-10-20T00:00:00.000Z',
  createdAt: '2026-10-20T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('reservation receipt email', () => {
  it('受付情報と仮予約の説明をテキスト・HTMLへ出力する', () => {
    const content = buildReservationReceiptEmail(email)
    expect(content.text).toContain('予約ID: R-20261020-abc')
    expect(content.text).toContain('希望時間帯: 午前')
    expect(content.text).toContain('コース: 体験ダイビング')
    expect(content.text).toContain('人数: 2名')
    expect(content.text).toContain('予約確定の通知ではありません')
    expect(content.html).toContain('&lt;山田&gt;')
  })

  it('Resendへ予約ID固定の冪等キーを付けて送信する', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('RESEND_FROM_EMAIL', '店 <noreply@example.com>')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendReservationReceiptEmail(email)).resolves.toBe('provider-1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test',
          'Idempotency-Key': 'reservation-received/R-20261020-abc',
        }),
      }),
    )
  })
})
