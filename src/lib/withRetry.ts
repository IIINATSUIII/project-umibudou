/**
 * Google Sheets APIのレート制限（429等）に備えた指数バックオフ付きリトライ（詳細設計書 2-5-1、MSG-17相当）。
 * ローカルJSONストア利用時はレート制限が発生しないため実質素通りする。
 */
export class RateLimitedError extends Error {}

function isRateLimitError(err: unknown): boolean {
  const status = (err as { code?: number; status?: number } | undefined)?.code
    ?? (err as { status?: number } | undefined)?.status
  if (status === 429) return true
  const message = err instanceof Error ? err.message : String(err)
  return /rate limit|quota/i.test(message)
}

export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts - 1
      if (!isRateLimitError(err) || isLastAttempt) {
        if (isRateLimitError(err)) throw new RateLimitedError('Sheets API rate limited')
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 300))
    }
  }
  // ここには到達しない（ループ内で必ず return か throw する）
  throw new Error('unreachable')
}
