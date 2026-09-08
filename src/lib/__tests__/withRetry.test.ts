import { describe, it, expect, vi } from 'vitest'
import { withRetry, RateLimitedError } from '../withRetry'

describe('withRetry', () => {
  it('成功時はリトライせずそのまま結果を返す', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('レート制限エラーの場合はリトライして最終的に成功する', async () => {
    const rateLimitErr = Object.assign(new Error('rate limit exceeded'), { code: 429 })
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce('ok')
    await expect(withRetry(fn, 3)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('レート制限エラーが続く場合は最終的にRateLimitedErrorを投げる（MSG-17相当）', async () => {
    const rateLimitErr = Object.assign(new Error('quota exceeded'), { code: 429 })
    const fn = vi.fn().mockRejectedValue(rateLimitErr)
    await expect(withRetry(fn, 3)).rejects.toThrow(RateLimitedError)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('レート制限以外のエラーはリトライせず即座に投げる', async () => {
    const otherErr = new Error('validation failed')
    const fn = vi.fn().mockRejectedValue(otherErr)
    await expect(withRetry(fn, 3)).rejects.toThrow('validation failed')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
