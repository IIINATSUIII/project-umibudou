'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { createReservation } from '@/lib/api'
import type { Reservation } from '@/types'

const COURSES = [
  '体験ダイビング',
  'ファンダイビング（2本）',
  'ファンダイビング（3本）',
  'ナイトダイビング',
  'シュノーケリング',
  'その他',
]

export default function NewReservationPage() {
  const user = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    time: '09:00',
    course: '体験ダイビング',
    guestName: '',
    guestCount: 1,
    phone: '',
    channel: 'phone' as Reservation['channel'],
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user === undefined) return
    if (!user) router.push('/login')
  }, [user, router])

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await createReservation({
      id: `R${Date.now()}`,
      ...form,
      status: 'confirmed',
    })
    router.push('/reservations')
  }

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-6 pb-20 md:pb-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
          <h1 className="text-xl font-bold text-gray-800">新規予約登録</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">日付 *</label>
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)}
                required className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">時間 *</label>
              <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)}
                required className={inp} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">コース *</label>
            <select value={form.course} onChange={(e) => set('course', e.target.value)} className={inp}>
              {COURSES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ゲスト名 *</label>
            <input type="text" value={form.guestName} onChange={(e) => set('guestName', e.target.value)}
              placeholder="田中 花子" required className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">人数 *</label>
              <input type="number" min={1} max={20} value={form.guestCount}
                onChange={(e) => set('guestCount', Number(e.target.value))} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">受付チャネル</label>
              <select value={form.channel}
                onChange={(e) => set('channel', e.target.value as Reservation['channel'])} className={inp}>
                <option value="hp">HP</option>
                <option value="email">メール</option>
                <option value="phone">電話</option>
                <option value="ota">OTA</option>
                <option value="sns">SNS</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話番号 *</label>
            <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)}
              placeholder="090-0000-0000" required className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
              placeholder="特記事項など" rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => router.back()}
              className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              キャンセル
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-ocean-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-ocean-700 transition-colors disabled:opacity-50">
              {saving ? '登録中…' : '予約を登録'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500'
