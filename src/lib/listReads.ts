/**
 * スタッフ画面の一覧ポーリング用の読取（Issue #68）。
 * Sheetsが主ストアのときだけ短期キャッシュを通し、複数画面の同時ポーリングでも読取枠を守る。
 * 書込・競合チェックの経路では使わず、store から直接最新値を読むこと。
 */

import { store, USES_SHEETS_STORE } from './dataStore'
import { cachedRead } from './readCache'
import type { QuestionnaireData, Reservation } from '@/types'

export function getReservationsForList(): Promise<Reservation[]> {
  return USES_SHEETS_STORE
    ? cachedRead('RESERVATIONS', () => store.getReservations())
    : store.getReservations()
}

export function getQuestionnairesForList(): Promise<QuestionnaireData[]> {
  return USES_SHEETS_STORE
    ? cachedRead('QUESTIONNAIRES', () => store.getQuestionnaires())
    : store.getQuestionnaires()
}
