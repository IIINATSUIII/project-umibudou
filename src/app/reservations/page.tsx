'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchReservations, patchReservation } from '@/lib/api'
import {
  cancelledReservationStatus,
  confirmedReservationStatus,
  isCancellableReservationStatus,
  isPendingReservationStatus,
  reservationStatusLabel,
  reservationStatusStyle,
} from '@/lib/reservationStatus'
import type { Reservation } from '@/types'

const CHANNEL_LABELS: Record<string, string> = {
  hp: 'HP', email: 'メール', phone: '電話', ota: 'OTA', sns: 'SNS', google_form: 'Googleフォーム',
}
const TIME_SLOT_LABELS: Record<string, string> = {
  morning: '午前', afternoon: '午後', full: '終日', unspecified: '時間未定',
}

function displayTime(reservation: Reservation): string {
  return reservation.time || TIME_SLOT_LABELS[reservation.timeSlot] || reservation.timeSlot
}

export default function ReservationsPage() {
  const user = useAuth()
  const router = useRouter()
  const [reservations, setReservations] = useState<Reservation[]>([])
  // 空文字 = 全件表示。日付を選ぶとその日のみ表示
  const [dateFilter, setDateFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    const load = () => fetchReservations().then((data) => { setReservations(data); setLoading(false) })
    load()
    // 客側フォームからの申し込みを自動反映（10秒ごと＋ウィンドウ復帰時）
    const iv = setInterval(load, 10000)
    window.addEventListener('focus', load)
    return () => { clearInterval(iv); window.removeEventListener('focus', load) }
  }, [user, router])

  const filtered = reservations
    .filter((r) => !dateFilter || r.diveDate === dateFilter)
    .sort((a, b) => a.diveDate.localeCompare(b.diveDate) || (a.time ?? '').localeCompare(b.time ?? ''))

  async function handleCancel(id: string) {
    if (!confirm('この予約をキャンセルしますか？')) return
    const reservation = reservations.find((item) => item.id === id)
    const status = reservation ? cancelledReservationStatus(reservation) : 'STS-04'
    await patchReservation(id, { status })
    setReservations((prev) =>
      prev.map((r) => r.id === id ? { ...r, status } : r)
    )
  }

  async function handleConfirm(id: string) {
    const reservation = reservations.find((item) => item.id === id)
    const status = reservation ? confirmedReservationStatus(reservation) : 'STS-03'
    await patchReservation(id, { status })
    setReservations((prev) =>
      prev.map((r) => r.id === id ? { ...r, status } : r)
    )
  }

  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    alert(`📥 "${file.name}" を読み込みました\n\nCSV をパースして /api/reservations に POST します。`)
    e.target.value = ''
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800 flex-1">📅 予約管理</h1>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter('')}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
              すべて表示
            </button>
          )}
          <label className="cursor-pointer text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            📥 CSV取込
            <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
          </label>
          <Link href="/reservations/new"
            className="bg-ocean-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-ocean-700 transition-colors">
            ＋ 予約追加
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">
              {dateFilter ? 'この日の予約はありません' : '予約はありません'}
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <div key={r.id} className="px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5 w-14 shrink-0">
                      {!dateFilter && (
                        <div className="text-xs text-gray-500">
                          {r.diveDate.slice(5).replace('-', '/')}
                        </div>
                      )}
                      <div className="text-sm font-mono font-bold text-ocean-600">{displayTime(r)}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-800">{r.guestName}</span>
                        <span className="text-sm text-gray-500">{r.guestCount}名</span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{CHANNEL_LABELS[r.channel]}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${reservationStatusStyle(r.status)}`}>{reservationStatusLabel(r.status)}</span>
                      </div>
                      <div className="text-sm text-gray-600">{r.courseName}</div>
                      <div className="text-xs text-gray-400 mt-0.5">📞 {r.guestPhone}</div>
                      {r.staffNote && <div className="text-xs text-gray-500 mt-1 bg-gray-50 rounded px-2 py-1">💬 {r.staffNote}</div>}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {r.questionnaireId || r.questionnaireIds ? (
                        <Link href={`/questionnaire/scan?id=${r.id}`}
                          className="text-xs bg-teal-50 text-teal-700 border border-teal-200 px-2 py-1 rounded text-center hover:bg-teal-100">
                          📋 問診確認
                        </Link>
                      ) : (
                        <Link href={`/questionnaire/${r.id}?token=${encodeURIComponent(r.questionnaireToken ?? '')}`}
                          className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-1 rounded text-center hover:bg-orange-100">
                          📝 問診URL
                        </Link>
                      )}
                      {(r.questionnaireId || r.questionnaireIds) && (
                        <Link href={`/questionnaire/${r.id}?token=${encodeURIComponent(r.questionnaireToken ?? '')}`}
                          className="text-xs text-ocean-700 border border-ocean-200 px-2 py-1 rounded text-center hover:bg-ocean-50">
                          📝 追加参加者URL
                        </Link>
                      )}
                      {isPendingReservationStatus(r.status) && (
                        <button onClick={() => handleConfirm(r.id)}
                          className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                          ✓ 確定する
                        </button>
                      )}
                      {isCancellableReservationStatus(r.status) && (
                        <button onClick={() => handleCancel(r.id)}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 border border-red-200 rounded hover:bg-red-50">
                          キャンセル
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
