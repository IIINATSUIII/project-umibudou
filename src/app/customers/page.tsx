'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchCustomers } from '@/lib/api'
import {
  C_CARD_FILTER_ALL,
  C_CARD_FILTER_NONE,
  CUSTOMER_SORTS,
  CUSTOMER_SORT_LABELS,
  LAST_VISIT_RANGES,
  LAST_VISIT_RANGE_LABELS,
  cCardFilterOptions,
  formatLastVisitAgo,
  matchesCCardFilter,
  matchesCustomerQuery,
  matchesLastVisitRange,
  sortCustomers,
} from '@/lib/customer'
import type { CustomerSort, LastVisitRange } from '@/lib/customer'
import type { Customer } from '@/types'

/** 一度に表示する件数。残りは「さらに表示」で追加する */
const PAGE_SIZE = 50

/** 検索条件をURLに書き戻すまでの待ち時間(ms)。入力のたびに遷移させないため */
const URL_SYNC_DELAY = 250

const DEFAULT_SORT: CustomerSort = 'lastVisitDesc'

const SELECT_CLASS =
  'border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ocean-500'

function LoadingScreen() {
  return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>
}

// useSearchParams を使う都合上、Suspense 境界の内側に本体を置く
export default function CustomersPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <CustomersView />
    </Suspense>
  )
}

function CustomersView() {
  const user = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  // 検索条件（詳細設計 §3-5-8「氏名・最終来店日・Cカード種別等」）。
  // 初期値はURLから復元する。顧客詳細(SC-08)から戻ったときに条件が消えないようにするため
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [cCard, setCCard] = useState(() => searchParams.get('ccard') ?? C_CARD_FILTER_ALL)
  const [lastVisitRange, setLastVisitRange] = useState<LastVisitRange>(
    () => pickFromUrl(searchParams.get('range'), LAST_VISIT_RANGES, 'all')
  )
  const [sort, setSort] = useState<CustomerSort>(
    () => pickFromUrl(searchParams.get('sort'), CUSTOMER_SORTS, DEFAULT_SORT)
  )
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    fetchCustomers().then((data) => { setCustomers(data); setLoading(false) })
  }, [user, router])

  // 条件を変えたら先頭から見せ直す
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, cCard, lastVisitRange, sort])

  // 現在の検索条件をURLへ反映する。初期値と同じ項目は付けずURLを短く保つ
  useEffect(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search)
    if (cCard !== C_CARD_FILTER_ALL) params.set('ccard', cCard)
    if (lastVisitRange !== 'all') params.set('range', lastVisitRange)
    if (sort !== DEFAULT_SORT) params.set('sort', sort)
    const qs = params.toString()

    // 入力のたびに遷移するとキー入力が重くなるので少し待つ。
    // replace なので「戻る」の履歴は汚さない
    const timer = setTimeout(() => {
      router.replace(qs ? `/customers?${qs}` : '/customers', { scroll: false })
    }, URL_SYNC_DELAY)
    return () => clearTimeout(timer)
  }, [search, cCard, lastVisitRange, sort, router])

  // Cカード種別の選択肢は実データから生成する（既存値が自由記述のため）
  const cCardOptions = useMemo(() => cCardFilterOptions(customers), [customers])

  // URLで指定された種別が実データに無い場合（古いURL等）は「すべて」に戻す
  useEffect(() => {
    if (loading || cCard === C_CARD_FILTER_ALL || cCard === C_CARD_FILTER_NONE) return
    if (!cCardOptions.includes(cCard)) setCCard(C_CARD_FILTER_ALL)
  }, [loading, cCard, cCardOptions])

  const filtered = useMemo(() => {
    const today = new Date()
    const matched = customers.filter((c) =>
      matchesCustomerQuery(c, search) &&
      matchesCCardFilter(c, cCard) &&
      matchesLastVisitRange(c, lastVisitRange, today)
    )
    return sortCustomers(matched, sort)
  }, [customers, search, cCard, lastVisitRange, sort])

  const isFiltered =
    !!search.trim() || cCard !== C_CARD_FILTER_ALL || lastVisitRange !== 'all'

  function clearFilters() {
    setSearch('')
    setCCard(C_CARD_FILTER_ALL)
    setLastVisitRange('all')
  }

  if (loading) return <LoadingScreen />

  const visible = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visible.length

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800 flex-1">👥 顧客台帳</h1>
          {/* 絞り込みが効いているかを件数で確認できるようにする */}
          <span className="text-sm text-gray-500">
            {isFiltered ? `${filtered.length}名 / 全${customers.length}名` : `${customers.length}名登録`}
          </span>
        </div>

        <div className="space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 氏名・かな・電話番号・メールで検索"
            aria-label="顧客のフリーワード検索"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 bg-white"
          />

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={cCard}
              onChange={(e) => setCCard(e.target.value)}
              aria-label="Cカード種別で絞り込み"
              className={SELECT_CLASS}
            >
              <option value={C_CARD_FILTER_ALL}>Cカード：すべて</option>
              <option value={C_CARD_FILTER_NONE}>Cカードなし</option>
              {cCardOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select
              value={lastVisitRange}
              onChange={(e) => setLastVisitRange(e.target.value as LastVisitRange)}
              aria-label="最終来店日で絞り込み"
              className={SELECT_CLASS}
            >
              {LAST_VISIT_RANGES.map((r) => (
                <option key={r} value={r}>{LAST_VISIT_RANGE_LABELS[r]}</option>
              ))}
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as CustomerSort)}
              aria-label="並び替え"
              className={SELECT_CLASS}
            >
              {CUSTOMER_SORTS.map((s) => (
                <option key={s} value={s}>{CUSTOMER_SORT_LABELS[s]}</option>
              ))}
            </select>

            {isFiltered && (
              <button
                onClick={clearFilters}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
              >
                条件をクリア
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">
            {isFiltered ? '条件に一致する顧客がいません' : '顧客が登録されていません'}
          </p>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {visible.map((c) => (
                <Link key={c.id} href={`/customers/${c.id}`}
                  className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-ocean-100 flex items-center justify-center text-ocean-700 font-bold text-sm shrink-0">
                    {c.lastName.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.lastName} {c.firstName}</span>
                      <span className="text-xs text-gray-400">{c.lastNameKana} {c.firstNameKana}</span>
                      {c.hasCCard ? (
                        <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">{c.cCardType}</span>
                      ) : (
                        <span className="text-xs bg-gray-50 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded">Cカードなし</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      来店 {c.visitCount}回 ・{' '}
                      {c.lastVisit
                        ? `最終 ${c.lastVisit}（${formatLastVisitAgo(c.lastVisit)}）`
                        : '来店実績なし'}
                    </div>
                  </div>
                  <div className="text-gray-300 text-lg shrink-0">›</div>
                </Link>
              ))}
            </div>

            {remaining > 0 && (
              <button
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="w-full border border-gray-300 bg-white rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                さらに表示（残り{remaining}名）
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}

/** URLの値が想定の選択肢に含まれていればそれを、無ければ既定値を返す */
function pickFromUrl<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}
