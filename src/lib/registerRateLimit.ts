import type { NextRequest } from 'next/server'

/**
 * 招待なしのスタッフ登録は誰でも呼べるため、送信元ごとに登録試行回数を制限する。
 * プロセス内メモリで数えるだけなので、複数インスタンス間では共有されない。
 */
const WINDOW_MS = 60 * 60 * 1000
const MAX_ATTEMPTS = 5
const MAX_TRACKED_KEYS = 10_000

type AttemptState = { count: number; firstAttemptAt: number }

const attempts = new Map<string, AttemptState>()

function pruneExpired(now: number): void {
  for (const [key, state] of attempts) {
    if (now - state.firstAttemptAt >= WINDOW_MS) attempts.delete(key)
  }
}

/** 送信元IP。ホスティング側が付けるヘッダーを優先し、取れない場合は共通のキーにまとめる。 */
export function registrationClientKey(req: NextRequest): string {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

/** 試行を1回数え、上限を超えていれば true を返す。 */
export function consumeRegistrationAttempt(key: string, now = Date.now()): boolean {
  pruneExpired(now)
  const current = attempts.get(key)
  if (!current) {
    // 追跡数が上限に達したら、新しい送信元を素通しせず拒否する。
    if (attempts.size >= MAX_TRACKED_KEYS) return true
    attempts.set(key, { count: 1, firstAttemptAt: now })
    return false
  }
  if (current.count >= MAX_ATTEMPTS) return true
  current.count += 1
  return false
}

/** テスト用 */
export function resetRegistrationAttempts(): void {
  attempts.clear()
}
