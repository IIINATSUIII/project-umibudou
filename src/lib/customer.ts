/**
 * 顧客台帳の絞り込み・並び替えの共有定義（クライアント・サーバー両用の純関数のみ）
 * 出典: docs/03_基本設計書_DB設計編.md §3-1、docs/04_詳細設計書.md §3-5-8・§4-4
 *
 * フリーワード検索そのものは lib/customerSearch.ts の matchesCustomer が持つ
 * （sheets.ts / localStore.ts のサーバー側検索と同じ判定を使うため）。
 */

import { normalizeCustomerText } from './customerSearch'
import type { Customer } from '@/types'

// ─── Cカード種別による絞り込み（DB設計 §3-1 No.17） ─────────────

/** 仕様上のCカード種別。選択肢の並び順にのみ使う */
export const C_CARD_TYPE_ORDER = ['未取得', 'OW', 'AOW', 'Rescue', 'DM', 'Inst']

/** 絞り込みの特別値。これ以外は cCardType の実値がそのまま入る */
export const C_CARD_FILTER_ALL = 'all'
export const C_CARD_FILTER_NONE = 'none'

/**
 * 絞り込み用のCカード種別リストを実データから生成する。
 * 既存データの cCardType は自由記述（'AOW' と 'Rescue Diver' が混在）のため、
 * 固定の選択肢にすると既存顧客を取りこぼす。実値から作れば移行不要で漏れない。
 */
export function cCardFilterOptions(customers: Customer[]): string[] {
  const types = new Set<string>()
  for (const c of customers) {
    if (c.hasCCard && c.cCardType) types.add(c.cCardType)
  }
  return Array.from(types).sort((a, b) => {
    const ia = C_CARD_TYPE_ORDER.indexOf(a)
    const ib = C_CARD_TYPE_ORDER.indexOf(b)
    // 仕様の並び順を優先し、それ以外は後ろへ五十音／アルファベット順で
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b, 'ja')
  })
}

export function matchesCCardFilter(customer: Customer, filter: string): boolean {
  if (filter === C_CARD_FILTER_ALL) return true
  if (filter === C_CARD_FILTER_NONE) return !customer.hasCCard
  return customer.hasCCard && customer.cCardType === filter
}

// ─── 最終来店日による絞り込み ──────────────────────────────────

export const LAST_VISIT_RANGES = ['all', 'within3m', 'within6m', 'within1y', 'over1y'] as const

export type LastVisitRange = (typeof LAST_VISIT_RANGES)[number]

export const LAST_VISIT_RANGE_LABELS: Record<LastVisitRange, string> = {
  all:      '最終来店：すべて',
  within3m: '3ヶ月以内',
  within6m: '6ヶ月以内',
  within1y: '1年以内',
  over1y:   '1年以上ご無沙汰',
}

/** Date → YYYY-MM-DD（ローカルタイム基準。toISOString はUTCずれが出るため使わない） */
function toDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 基準日から nヶ月前の日付を YYYY-MM-DD で返す */
function monthsBefore(base: Date, months: number): string {
  const d = new Date(base)
  d.setMonth(d.getMonth() - months)
  return toDateString(d)
}

/**
 * 最終来店日が指定期間に該当するか。
 * lastVisit が未設定の顧客（来店実績なし）は「すべて」以外にはヒットしない。
 */
export function matchesLastVisitRange(
  customer: Customer,
  range: LastVisitRange,
  today: Date = new Date()
): boolean {
  if (range === 'all') return true
  if (!customer.lastVisit) return false
  // lastVisit は YYYY-MM-DD 固定なので文字列比較がそのまま日付比較になる
  switch (range) {
    case 'within3m': return customer.lastVisit >= monthsBefore(today, 3)
    case 'within6m': return customer.lastVisit >= monthsBefore(today, 6)
    case 'within1y': return customer.lastVisit >= monthsBefore(today, 12)
    case 'over1y':   return customer.lastVisit < monthsBefore(today, 12)
  }
}

/** 最終来店日からの経過を「4ヶ月前」のような相対表記にする（休眠顧客の識別用） */
export function formatLastVisitAgo(lastVisit: string, today: Date = new Date()): string {
  if (!lastVisit) return '来店実績なし'
  const visited = new Date(`${lastVisit}T00:00:00`)
  if (Number.isNaN(visited.getTime())) return lastVisit

  // 双方ともローカルの0時に揃える。片方でも new Date('YYYY-MM-DD') を使うと
  // そちらだけUTC0時と解釈され、UTCより西の環境で1日ずれる
  const base = new Date(`${toDateString(today)}T00:00:00`)
  const days = Math.floor((base.getTime() - visited.getTime()) / 86400000)
  if (days < 0) return '来店予定'
  if (days === 0) return '今日'
  if (days === 1) return '昨日'
  if (days < 30) return `${days}日前`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}ヶ月前`
  return `${Math.floor(months / 12)}年前`
}

// ─── 並び替え ─────────────────────────────────────────────────

export const CUSTOMER_SORTS = ['lastVisitDesc', 'visitCountDesc', 'kanaAsc'] as const

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]

export const CUSTOMER_SORT_LABELS: Record<CustomerSort, string> = {
  lastVisitDesc:  '最終来店が新しい順',
  visitCountDesc: '来店回数が多い順',
  kanaAsc:        'かな五十音順',
}

/** 並び替えた新しい配列を返す（引数は破壊しない） */
export function sortCustomers(customers: Customer[], sort: CustomerSort): Customer[] {
  const sorted = [...customers]
  switch (sort) {
    case 'lastVisitDesc':
      // 未設定（空文字）は最後に回る
      return sorted.sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''))
    case 'visitCountDesc':
      return sorted.sort((a, b) => b.visitCount - a.visitCount)
    case 'kanaAsc':
      return sorted.sort((a, b) => customerKanaKey(a).localeCompare(customerKanaKey(b), 'ja'))
  }
}

/** 五十音ソート用のキー。カナ未登録の顧客は漢字氏名で代用する */
function customerKanaKey(c: Customer): string {
  const kana = normalizeCustomerText(`${c.lastNameKana ?? ''}${c.firstNameKana ?? ''}`)
  return kana || normalizeCustomerText(`${c.lastName ?? ''}${c.firstName ?? ''}`)
}
