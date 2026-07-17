'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import WeatherWidget from '@/components/WeatherWidget'
import { useAuth } from '@/lib/authContext'
import { fetchReservations, patchReservation } from '@/lib/api'
import type { Reservation } from '@/types'

const CHANNEL_LABELS: Record<string, string> = {
  hp: 'HP', email: 'メール', phone: '電話', ota: 'OTA', sns: 'SNS',
}
const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  pending:   'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
}
const STATUS_LABELS: Record<string, string> = {
  confirmed: '確定', pending: '仮押さえ', cancelled: 'キャンセル',
}

export default function DashboardPage() {
  const user = useAuth()
  const router = useRouter()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)

  const today    = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    const load = () => fetchReservations().then((data) => {
      setReservations(data)
      setLoading(false)
    })
    load()
    // 客側フォームからの申し込みを自動反映（10秒ごと＋ウィンドウ復帰時）
    const iv = setInterval(load, 10000)
    window.addEventListener('focus', load)
    return () => { clearInterval(iv); window.removeEventListener('focus', load) }
  }, [user, router])

  async function handleConfirm(id: string) {
    await patchReservation(id, { status: 'confirmed' })
    setReservations((prev) =>
      prev.map((r) => r.id === id ? { ...r, status: 'confirmed' } : r)
    )
  }

  const todayRes    = reservations.filter((r) => r.date === today)
  const tomorrowRes = reservations.filter((r) => r.date === tomorrow)
  // 未確定の申し込みは日付に関係なくすべて表示する（客側フォームからの申し込みを見逃さないため）
  const pendingRes = reservations
    .filter((r) => r.status === 'pending')
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  const totalGuests = todayRes.reduce((s, r) => s + r.guestCount, 0)
  const withQr      = todayRes.filter((r) => r.questionnaireId).length

  if (loading) return <LoadingScreen />

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6 space-y-6">

        {pendingRes.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-yellow-200">
              <h2 className="font-semibold text-yellow-800">
                🔔 未確定の申し込み（{pendingRes.length}件）
              </h2>
              <Link href="/reservations" className="text-xs text-yellow-700 underline hover:text-yellow-900">
                予約管理で見る
              </Link>
            </div>
            <div className="divide-y divide-yellow-100">
              {pendingRes.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="text-sm font-mono font-semibold text-yellow-800 shrink-0">
                    {r.date.slice(5).replace('-', '/')} {r.time}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 text-sm">{r.guestName}（{r.guestCount}名）</div>
                    <div className="text-xs text-gray-500">{r.course} ／ {CHANNEL_LABELS[r.channel]}経由</div>
                  </div>
                  <button onClick={() => handleConfirm(r.id)}
                    className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 shrink-0">
                    ✓ 確定する
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: '今日の予約', value: `${todayRes.length} 件`, color: 'text-ocean-600' },
            { label: '参加者合計', value: `${totalGuests} 名`, color: 'text-teal-600' },
            { label: '問診票提出', value: `${withQr} / ${todayRes.length}`, color: 'text-purple-600' },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-xs text-gray-500 mt-1">{c.label}</div>
            </div>
          ))}
        </div>

        <WeatherWidget />

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">📅 今日の予約</h2>
            <Link href="/reservations/new"
              className="text-xs bg-ocean-600 text-white px-3 py-1.5 rounded-lg hover:bg-ocean-700 transition-colors">
              ＋ 予約追加
            </Link>
          </div>
          {todayRes.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">今日の予約はありません</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {todayRes.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="text-sm font-mono font-semibold text-ocean-600 w-12">{r.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-800 text-sm">{r.guestName}（{r.guestCount}名）</div>
                    <div className="text-xs text-gray-500">{r.course}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {CHANNEL_LABELS[r.channel]}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                    {r.questionnaireId ? (
                      <Link href={`/questionnaire/scan?id=${r.questionnaireId}`}
                        className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded hover:bg-teal-100">
                        📋 問診確認
                      </Link>
                    ) : (
                      <Link href={`/questionnaire/${r.id}`}
                        className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded hover:bg-orange-100">
                        📝 問診未提出
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {tomorrowRes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">📅 明日の予約</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {tomorrowRes.map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="text-sm font-mono font-semibold text-gray-500 w-12">{r.time}</div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-700 text-sm">{r.guestName}（{r.guestCount}名）</div>
                    <div className="text-xs text-gray-400">{r.course}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-400 text-sm">読み込み中…</div>
    </div>
  )
}
