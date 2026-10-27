import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReservationEmail } from '@/types'

const memory = vi.hoisted(() => ({
  emails: [] as ReservationEmail[],
  send: vi.fn(),
}))

vi.mock('@/lib/dataStore', () => ({
  store: {
    getReservations: async () => [],
    getReservationEmails: async () => memory.emails,
    updateReservationEmail: async (id: string, delta: Partial<ReservationEmail>) => {
      const item = memory.emails.find((email) => email.id === id)!
      Object.assign(item, delta)
    },
  },
}))
vi.mock('../storeLock', () => ({
  withStoreWriteLock: async <T>(work: () => Promise<T>) => work(),
}))
vi.mock('../reservationEmail', () => ({
  isReservationEmailConfigured: () => true,
  sendReservationReceiptEmail: memory.send,
}))

import { retryReservationEmail, runReservationEmailOutbox } from '../reservationEmailWorker'

function queued(over: Partial<ReservationEmail> = {}): ReservationEmail {
  return {
    id: 'RE-R-1',
    reservationId: 'R-1',
    requestKey: 'request-1',
    recipientEmail: 'guest@example.com',
    guestName: '山田太郎',
    diveDate: '2026-10-21',
    timeSlot: 'morning',
    courseId: 'CRS-001',
    courseName: '体験ダイビング',
    guestCount: 1,
    status: 'pending',
    attemptCount: 0,
    availableAt: '2026-10-20T00:00:00.000Z',
    createdAt: '2026-10-20T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  memory.emails = [queued()]
  memory.send.mockReset().mockResolvedValue('provider-1')
})

describe('reservation email outbox worker', () => {
  it('成功時は送信済みとして記録する', async () => {
    const result = await runReservationEmailOutbox(Date.parse('2026-10-20T00:01:00.000Z'))
    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0 })
    expect(memory.emails[0]).toMatchObject({ status: 'sent', providerMessageId: 'provider-1', attemptCount: 1 })
  })

  it('一時失敗は次回実行時刻を設定して再送対象に戻す', async () => {
    memory.send.mockRejectedValue(new Error('temporary provider failure'))
    const result = await runReservationEmailOutbox(Date.parse('2026-10-20T00:01:00.000Z'))
    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1, deadLettered: 0 })
    expect(memory.emails[0]).toMatchObject({ status: 'failed', attemptCount: 1, lastError: 'Error' })
    expect(Date.parse(memory.emails[0].availableAt)).toBeGreaterThan(Date.parse('2026-10-20T00:01:00.000Z'))
  })

  it('最大試行回数に達したらデッドレター化する', async () => {
    memory.emails = [queued({ attemptCount: 11 })]
    memory.send.mockRejectedValue(new Error('permanent provider failure'))
    const result = await runReservationEmailOutbox(Date.parse('2026-10-20T00:01:00.000Z'))
    expect(result.deadLettered).toBe(1)
    expect(memory.emails[0]).toMatchObject({ status: 'dead_letter', attemptCount: 12 })
  })

  it('スタッフの手動再送でデッドレターを初期化する', async () => {
    memory.emails = [queued({ status: 'dead_letter', attemptCount: 12, lastError: 'Error' })]
    await expect(retryReservationEmail('R-1')).resolves.toBe('requeued')
    expect(memory.emails[0]).toMatchObject({ status: 'pending', attemptCount: 0, lastError: '' })
  })
})
