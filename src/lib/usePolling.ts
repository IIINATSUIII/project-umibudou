'use client'

import { useEffect, useRef } from 'react'
import { ApiRequestError } from './api'

/**
 * 一覧の自動更新（Issue #68）。Sheetsの読取枠を複数画面で共有するため、
 * - 前回の取得が終わってから次を予約し、重ねて取得しない
 * - タブが非表示の間は（初回を除き）取得しない（表示・フォーカス復帰時にすぐ取得する）
 * - 失敗（API制限の503など）が続くと間隔を伸ばし、成功したら元に戻す。止めはしない
 */
export const POLL_INTERVAL_MS = 30_000
export const POLL_MAX_INTERVAL_MS = 5 * 60_000
/** フォーカス復帰が連続しても、この間隔以内なら取得し直さない */
const RESUME_MIN_GAP_MS = 5_000

export function nextPollDelay(consecutiveFailures: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, POLL_MAX_INTERVAL_MS)
}

export function usePolling(load: () => Promise<void>, enabled: boolean): void {
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let running = false
    let failures = 0
    let lastStartedAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = () => {
      clearTimeout(timer)
      if (!stopped) timer = setTimeout(run, nextPollDelay(failures))
    }
    const run = async () => {
      if (stopped || running) return
      // 初回は非表示でも読み込む（「読み込み中」のまま止めない）。以降の定期取得だけ非表示中は休む
      if (lastStartedAt > 0 && document.visibilityState === 'hidden') { schedule(); return }
      running = true
      lastStartedAt = Date.now()
      try {
        await loadRef.current()
        failures = 0
      } catch {
        failures += 1
      } finally {
        running = false
        schedule()
      }
    }
    const resume = () => {
      if (document.visibilityState === 'hidden') return
      // 復帰時は最新を見せる。ただしバックオフ中は通常間隔より短い再取得はしない（読取を増やさない）
      const minGap = failures === 0 ? RESUME_MIN_GAP_MS : POLL_INTERVAL_MS
      if (Date.now() - lastStartedAt >= minGap) void run()
    }

    void run()
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      stopped = true
      clearTimeout(timer)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [enabled])
}

/** 自動更新の失敗時に表示する文言。表示中のデータは残すため、その旨を伝える */
export function pollingErrorMessage(err: unknown): string {
  return err instanceof ApiRequestError && err.status === 503
    ? '通信が集中しているため最新の情報を取得できませんでした。表示中の内容は直前のものです（自動で再試行します）。'
    : 'データを読み込めませんでした。自動で再試行します。'
}
