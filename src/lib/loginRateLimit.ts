const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

type FailureState = { count: number; firstFailureAt: number; blockedUntil: number }

const failures = new Map<string, FailureState>()

function normalizeKey(email: string): string {
  return email.trim().toLowerCase()
}

export function isLoginRateLimited(email: string): boolean {
  const key = normalizeKey(email)
  const state = failures.get(key)
  if (!state) return false
  const now = Date.now()
  if (state.blockedUntil > now) return true
  if (now - state.firstFailureAt >= WINDOW_MS) failures.delete(key)
  return false
}

export function recordLoginFailure(email: string): void {
  const key = normalizeKey(email)
  const now = Date.now()
  const current = failures.get(key)
  if (!current || now - current.firstFailureAt >= WINDOW_MS) {
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

