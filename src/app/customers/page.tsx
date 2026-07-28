'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchCustomers } from '@/lib/api'
import type { Customer } from '@/types'

export default function CustomersPage() {
  const user = useAuth()
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [lastVisitFilter, setLastVisitFilter] = useState('')
  const [cCardFilter, setCCardFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    fetchCustomers().then((data) => { setCustomers(data); setLoading(false) })
  }, [user, router])

  const cCardOptions = Array.from(new Set(customers.map((c) => c.cCardType || '未取得'))).sort()

  const filtered = customers.filter((c) => {
    if (search) {
      const q = search.toLowerCase()
      const matches =
        `${c.lastName}${c.firstName}`.includes(q) ||
        `${c.lastNameKana}${c.firstNameKana}`.toLowerCase().includes(q) ||
        c.phone.includes(q)
      if (!matches) return false
    }
    if (lastVisitFilter && c.lastVisit !== lastVisitFilter) return false
    if (cCardFilter && (c.cCardType || '未取得') !== cCardFilter) return false
    return true
  })

  const hasFilter = !!(search || lastVisitFilter || cCardFilter)

  function clearFilters() {
    setSearch('')
    setLastVisitFilter('')
    setCCardFilter('')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800 flex-1">👥 顧客台帳</h1>
          <span className="text-sm text-gray-500">{customers.length}名登録</span>
        </div>

        <div className="space-y-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 氏名・かな・電話番号で検索"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 bg-white" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500">最終来店日</label>
            <input
              type="date"
              value={lastVisitFilter}
              onChange={(e) => setLastVisitFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 bg-white"
            />
            <label className="text-xs text-gray-500 ml-2">Cカード種別</label>
            <select
              value={cCardFilter}
              onChange={(e) => setCCardFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 bg-white"
            >
              <option value="">すべて</option>
              {cCardOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {hasFilter && (
              <button onClick={clearFilters}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
                すべて表示
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">
            {hasFilter ? '条件に一致する顧客が見つかりません' : '顧客が見つかりません'}
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {filtered.map((c) => (
              <Link key={c.id} href={`/customers/${c.id}`}
                className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition-colors">
                <div className="w-10 h-10 rounded-full bg-ocean-100 flex items-center justify-center text-ocean-700 font-bold text-sm shrink-0">
                  {c.lastName.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">{c.lastName} {c.firstName}</span>
                    <span className="text-xs text-gray-400">{c.lastNameKana} {c.firstNameKana}</span>
                    {c.hasCCard && (
                      <span className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">{c.cCardType}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">来店 {c.visitCount}回 ・ 最終 {c.lastVisit}</div>
                </div>
                <div className="text-gray-300 text-lg shrink-0">›</div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
