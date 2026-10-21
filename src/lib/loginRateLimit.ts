const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const MAX_TRACKED_EMAILS = 10_000

type FailureState = { count: number; firstFailureAt: number; blockedUntil: number }

const failures = new Map<string, FailureState>()

function normalizeKey(email: string): string {
  return email.trim().toLowerCase()
}

function pruneExpired(now: number): void {
  for (const [key, state] of failures) {
    if (now - state.firstFailureAt >= WINDOW_MS) failures.delete(key)
  }
}

export function isLoginRateLimited(email: string): boolean {
  const key = normalizeKey(email)
  const now = Date.now()
  pruneExpired(now)
  const state = failures.get(key)
  if (!state) return false
  if (state.blockedUntil > now) return true
  return false
}

export function recordLoginFailure(email: string): void {
  const key = normalizeKey(email)
  const now = Date.now()
  pruneExpired(now)
  const current = failures.get(key)
  if (!current || now - current.firstFailureAt >= WINDOW_MS) {
    if (!current && failures.size >= MAX_TRACKED_EMAILS) return
    failures.set(key, { count: 1, firstFailureAt: now, blockedUntil: 0 })
    return
  }
  const count = current.count + 1
  failures.set(key, {
    count,
    firstFailureAt: current.firstFailureAt,
    blockedUntil: count >= MAX_FAILURES ? current.firstFailureAt + WINDOW_MS : 0,
  })
}

export function clearLoginFailures(email: string): void {
  failures.delete(normalizeKey(email))
}

