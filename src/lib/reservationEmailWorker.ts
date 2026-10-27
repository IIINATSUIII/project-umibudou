import { store } from './dataStore'
import { withStoreWriteLock } from './storeLock'
import { reconcileReservationReceiptOutbox } from './reservations'
import {
  EmailConfigurationError,
  isReservationEmailConfigured,
  sendReservationReceiptEmail,
} from './reservationEmail'
import type { ReservationEmail } from '@/types'

const MAX_ATTEMPTS = 12
const LEASE_MS = 10 * 60 * 1000
const BATCH_LIMIT = 10

export interface ReservationEmailOutboxRunResult {
  claimed: number
  sent: number
  failed: number
  deadLettered: number
}

type ClaimedEmail = ReservationEmail & { attempt: number }

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 15 * 1000 * 2 ** Math.min(Math.max(attempt - 1, 0), 8))
}

function safeErrorKind(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) ? name : 'UnknownError'
}

function isDue(email: ReservationEmail, now: number): boolean {
  if (email.status === 'sent' || email.status === 'dead_letter') return false
  if (email.status === 'sending' && email.lockedUntil) {
    const lockedUntil = Date.parse(email.lockedUntil)
    if (Number.isFinite(lockedUntil) && lockedUntil > now) return false
  }
  const availableAt = Date.parse(email.availableAt)
  return !Number.isFinite(availableAt) || availableAt <= now
}

async function claimNext(now: number): Promise<ClaimedEmail | undefined> {
  if (store.claimReservationEmail) {
    const claimed = await store.claimReservationEmail(now, MAX_ATTEMPTS, LEASE_MS)
    return claimed ? { ...claimed, attempt: claimed.attemptCount } : undefined
  }
  return withStoreWriteLock(async () => {
    const emails = await store.getReservationEmails()
    const next = emails
      .filter((email) => isDue(email, now) && email.attemptCount < MAX_ATTEMPTS)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
    if (!next) return undefined
    const attempt = next.attemptCount + 1
    const lockedUntil = new Date(now + LEASE_MS).toISOString()
    await store.updateReservationEmail(next.id, {
      status: 'sending',
      attemptCount: attempt,
      lastAttemptAt: new Date(now).toISOString(),
      lockedUntil,
    })
    return { ...next, status: 'sending', attemptCount: attempt, lockedUntil, attempt }
  })
}

async function markSent(email: ClaimedEmail, providerMessageId: string, now: number): Promise<boolean> {
  const patch: Partial<ReservationEmail> = {
    status: 'sent', sentAt: new Date(now).toISOString(), providerMessageId,
    lockedUntil: '', lastError: '',
  }
  if (store.updateReservationEmailIfClaimed)
    return store.updateReservationEmailIfClaimed(email.id, email.attemptCount, email.lockedUntil!, patch)
  return withStoreWriteLock(async () => {
    const current = (await store.getReservationEmails()).find((item) => item.id === email.id)
    if (current?.status !== 'sending' || current.attemptCount !== email.attemptCount || current.lockedUntil !== email.lockedUntil) return false
    await store.updateReservationEmail(email.id, patch)
    return true
  })
}

async function markFailed(email: ClaimedEmail, error: unknown, now: number): Promise<'ignored' | 'failed' | 'dead_letter'> {
  const deadLetter = email.attempt >= MAX_ATTEMPTS
  const patch: Partial<ReservationEmail> = {
    status: deadLetter ? 'dead_letter' : 'failed',
    availableAt: new Date(deadLetter ? now : now + retryDelayMs(email.attempt)).toISOString(),
    lockedUntil: '', lastError: safeErrorKind(error),
  }
  if (store.updateReservationEmailIfClaimed) {
    const updated = await store.updateReservationEmailIfClaimed(email.id, email.attemptCount, email.lockedUntil!, patch)
    return updated ? (deadLetter ? 'dead_letter' : 'failed') : 'ignored'
  }
  return withStoreWriteLock(async () => {
    const current = (await store.getReservationEmails()).find((item) => item.id === email.id)
    if (current?.status !== 'sending' || current.attemptCount !== email.attemptCount || current.lockedUntil !== email.lockedUntil) return 'ignored'
    await store.updateReservationEmail(email.id, patch)
    return deadLetter ? 'dead_letter' : 'failed'
  })
}

async function deadLetterExpiredFinalAttempt(now: number): Promise<number> {
  return withStoreWriteLock(async () => {
    const emails = await store.getReservationEmails()
    const abandoned = emails.filter((email) => {
      if (email.status !== 'sending' || email.attemptCount < MAX_ATTEMPTS) return false
      const lease = email.lockedUntil ? Date.parse(email.lockedUntil) : Number.NaN
      return !Number.isFinite(lease) || lease <= now
    })
    let deadLettered = 0
    for (const email of abandoned) {
      const patch: Partial<ReservationEmail> = {
        status: 'dead_letter',
        availableAt: new Date(now).toISOString(),
        lockedUntil: '',
        lastError: 'WorkerLeaseExpired',
      }
      if (store.updateReservationEmailIfClaimed) {
        if (await store.updateReservationEmailIfClaimed(email.id, email.attemptCount, email.lockedUntil ?? '', patch))
          deadLettered += 1
      } else {
        await store.updateReservationEmail(email.id, patch)
        deadLettered += 1
      }
    }
    return deadLettered
  })
}

/** 予約受付メールを最大BATCH_LIMIT件処理する。送信失敗はOutboxへ戻して再送する。 */
export async function runReservationEmailOutbox(
  now = Date.now(),
): Promise<ReservationEmailOutboxRunResult> {
  if (!isReservationEmailConfigured())
    throw new EmailConfigurationError()

  const result: ReservationEmailOutboxRunResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    deadLettered: 0,
  }
  await reconcileReservationReceiptOutbox()
  result.deadLettered = await deadLetterExpiredFinalAttempt(now)
  for (let count = 0; count < BATCH_LIMIT; count += 1) {
    const email = await claimNext(now)
    if (!email) break
    result.claimed += 1
    try {
      const providerMessageId = await sendReservationReceiptEmail(email)
      if (await markSent(email, providerMessageId, now)) result.sent += 1
    } catch (error) {
      const marked = await markFailed(email, error, now)
      if (marked !== 'ignored') result.failed += 1
      if (marked === 'dead_letter') result.deadLettered += 1
    }
  }
  return result
}

export type ReservationEmailRetryResult = 'requeued' | 'already_sent' | 'not_found' | 'in_progress'

/** デッドレター化したメールをスタッフ操作で再送対象へ戻す。 */
export async function retryReservationEmail(
  reservationId: string,
): Promise<ReservationEmailRetryResult> {
  if (store.retryReservationEmailByReservationId)
    return store.retryReservationEmailByReservationId(reservationId)
  return withStoreWriteLock(async () => {
    const email = (await store.getReservationEmails()).find(
      (item) => item.reservationId === reservationId,
    )
    if (!email) return 'not_found'
    if (email.status === 'sent') return 'already_sent'
    await store.updateReservationEmail(email.id, {
      status: 'pending',
      attemptCount: 0,
      availableAt: new Date().toISOString(),
      lockedUntil: '',
      lastAttemptAt: '',
      lastError: '',
    })
    return 'requeued'
  })
}
