/**
 * 顧客台帳まわりの共有定義（クライアント・サーバー両用の純粋な定数／関数のみ）
 * 出典: docs/03_基本設計書_DB設計編.md §3-1、docs/04_詳細設計書.md §3-5-8・§4-4
 */

import type { Customer } from '@/types'

// ─── 検索文字列の正規化 ────────────────────────────────────────
//
// 日本語の氏名・電話番号は表記ゆれが激しく、素の includes() では
// 「佐藤 一郎」「さとう」「09033334444」がいずれもヒットしない。
// 検索語と検索対象の両方を同じ関数に通してから部分一致で判定する。

/** 半角カタカナ→全角カタカナの対応表（濁点・半濁点は別途合成する） */
const HALFWIDTH_KANA =
  'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ'
const FULLWIDTH_KANA =
  'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'

/** 濁点が付けられる全角カタカナ（コードポイント+1で濁音になる） */
const VOICEABLE = /[カ-トハ-ホ]/
/** 半濁点が付けられる全角カタカナ（コードポイント+2で半濁音になる） */
const SEMI_VOICEABLE = /[ハ-ホ]/

/** 半角カタカナ（ｻﾄｳ・ｶﾞ 等）を全角カタカナへ寄せる */
function halfwidthKanaToFullwidth(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    const idx = HALFWIDTH_KANA.indexOf(input[i])
    if (idx === -1) {
      out += input[i]
      continue
    }
    let kana = FULLWIDTH_KANA[idx]
    const next = input[i + 1]
    if (next === 'ﾞ' && kana === 'ウ') {
      kana = 'ヴ'
      i++
    } else if (next === 'ﾞ' && VOICEABLE.test(kana)) {
      kana = String.fromCharCode(kana.charCodeAt(0) + 1)
      i++
    } else if (next === 'ﾟ' && SEMI_VOICEABLE.test(kana)) {
      kana = String.fromCharCode(kana.charCodeAt(0) + 2)
      i++
    }
    out += kana
  }
  return out
}

/**
 * 検索用に文字列を正規化する。
 * 全角英数記号→半角、半角カナ→全角カナ、カタカナ→ひらがな、小文字化、空白除去。
 * 「サトウ」「さとう」「ｻﾄｳ」、「佐藤 一郎」「佐藤一郎」がすべて同一視される。
 */
export function normalizeSearchText(input: string): string {
  if (!input) return ''
  return halfwidthKanaToFullwidth(input)
    // 全角英数・記号 → 半角
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // カタカナ → ひらがな（ヴ→ゔ を含む）
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
    // 空白（全角スペース・タブ含む）を除去
    .replace(/\s+/g, '')
}

/**
 * 電話番号を数字のみに正規化する。
 * ハイフンの有無・全角数字を吸収し、下4桁だけでの検索を成立させる
 * （実務ではハイフン位置の表記ゆれが多く、下4桁検索が最も確実なため）。
 */
export function normalizePhone(input: string): string {
  if (!input) return ''
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
}

/**
 * フリーワード検索の判定。
 * 氏名（漢字）・氏名（カナ）・電話番号・メールアドレス・顧客IDを OR で部分一致。
 * メールアドレスは顧客台帳のユニークキー（DB設計 §3-1 No.13）なので検索対象に含める。
 */
export function matchesCustomerQuery(customer: Customer, query: string): boolean {
  const q = normalizeSearchText(query)
  if (!q) return true

  const targets = [
    `${customer.lastName}${customer.firstName}`,
    `${customer.lastNameKana}${customer.firstNameKana}`,
    customer.email,
    customer.id,
  ]
  if (targets.some((t) => normalizeSearchText(t).includes(q))) return true

  // 数字を含む検索語だけ電話番号と突き合わせる
  const digits = normalizePhone(query)
  return !!digits && normalizePhone(customer.phone).includes(digits)
}

// ─── Cカード種別による絞り込み（DB設計 §3-1 No.17） ─────────────

/** 仕様上の Cカード種別。選択肢の並び順にのみ使う */
export const C_CARD_TYPE_ORDER = ['未取得', 'OW', 'AOW', 'Rescue', 'DM', 'Inst']

/** 絞り込みの特別値。これ以外は cCardType の実値がそのまま入る */
export const C_CARD_FILTER_ALL = 'all'
export const C_CARD_FILTER_NONE = 'none'

/**
 * 絞り込み用の Cカード種別リストを実データから生成する。
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
  all:       '最終来店：すべて',
  within3m:  '3ヶ月以内',
  within6m:  '6ヶ月以内',
  within1y:  '1年以内',
  over1y:    '1年以上ご無沙汰',
}

/** 基準日から nヶ月前の日付を YYYY-MM-DD で返す */
function monthsBefore(base: Date, months: number): string {
  const d = new Date(base)
  d.setMonth(d.getMonth() - months)
  return toDateString(d)
}

/** Date → YYYY-MM-DD（ローカルタイム基準。toISOString はUTCずれが出るため使わない） */
function toDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
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
  // lastVisit は YYYY-MM-DD 固定なので文字列比較で日付比較になる
  switch (range) {
    case 'within3m': return customer.lastVisit >= monthsBefore(today, 3)
    case 'within6m': return customer.lastVisit >= monthsBefore(today, 6)
    case 'within1y': return customer.lastVisit >= monthsBefore(today, 12)
    case 'over1y':   return customer.lastVisit < monthsBefore(today, 12)
  }
}

/** 最終来店日からの経過を「4ヶ月前」のような相対表記にする（一覧での休眠顧客の識別用） */
export function formatLastVisitAgo(lastVisit: string, today: Date = new Date()): string {
  if (!lastVisit) return '来店実績なし'
  const visited = new Date(`${lastVisit}T00:00:00`)
  if (Number.isNaN(visited.getTime())) return lastVisit

  // 双方ともローカルの0時に揃える。片方でも new Date('YYYY-MM-DD') を使うと
  // そちらだけ UTC 0時と解釈され、UTCより西の環境で1日ずれる
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
  const kana = normalizeSearchText(`${c.lastNameKana}${c.firstNameKana}`)
  return kana || normalizeSearchText(`${c.lastName}${c.firstName}`)
}
