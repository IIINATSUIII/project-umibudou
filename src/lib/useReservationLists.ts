'use client'

import { useCallback, useState } from 'react'
import { fetchQuestionnaires, fetchReservations } from './api'
import { pollingErrorMessage, usePolling } from './usePolling'
import type { QuestionnaireData, Reservation } from '@/types'

/**
 * ダッシュボード・予約管理で共通の予約／問診一覧（Issue #68）。
 * 客側フォームからの申し込みを自動反映する（30秒ごと＋タブ表示・ウィンドウ復帰時。失敗時は間隔を伸ばす）。
 */
export function useReservationLists(enabled: boolean) {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try {
      const [res, qs] = await Promise.all([fetchReservations(), fetchQuestionnaires()])
      setReservations(res)
      setQuestionnaires(qs)
      setLoadError('')
    } catch (err) {
      setLoadError(pollingErrorMessage(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [])
  usePolling(load, enabled)

  /** 競合（409）後の再読込。サーバーの短期キャッシュを使わず最新を読む。失敗時は表示中の行を残す */
  const reloadReservationsFresh = useCallback(async () => {
    try {
      setReservations(await fetchReservations({ fresh: true }))
    } catch {
      /* keep the visible stale row */
    }
  }, [])

  return { reservations, setReservations, questionnaires, loading, loadError, reloadReservationsFresh }
}
