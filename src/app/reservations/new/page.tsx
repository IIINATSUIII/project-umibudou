'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { ApiRequestError, createReservation } from '@/lib/api'
import { COURSES, CONFIRMED_STATUS_ID, STAFF, STATUSES } from '@/lib/masters'
import type { Reservation } from '@/types'

const TIME_SLOTS: [Reservation['timeSlot'], string][] = [
  ['morning', '午前'], ['afternoon', '午後'], ['full', '1日'], ['unspecified', '指定なし'],
]

export default function NewReservationPage() {
  const user = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({
    diveDate: new Date().toISOString().slice(0, 10),
    timeSlot: 'morning' as Reservation['timeSlot'],
    courseId: COURSES[0].id,
    guestName: '',
    guestCount: 1,
    guestPhone: '',
    guestEmail: '',
    channel: 'phone' as Reservation['channel'],
    status: CONFIRMED_STATUS_ID,
    staffId: '',
    staffNote: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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
    setError('')
    setFieldErrors({})
    try {
      await createReservation(form)
      router.push('/reservations?saved=1')
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message)
        setFieldErrors(err.fields ?? {})
      } else {
        setError('予約の登録に失敗しました。時間をおいて再度お試しください')
      }
    } finally {
      setSaving(false)
    }
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
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ダイブ日 *</label>
              <input type="date" value={form.diveDate} onChange={(e) => set('diveDate', e.target.value)}
                required aria-invalid={Boolean(fieldErrors.diveDate)} className={inp} />
              {fieldErrors.diveDate && <p className={fieldError}>{fieldErrors.diveDate}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">時間帯 *</label>
              <select value={form.timeSlot} onChange={(e) => set('timeSlot', e.target.value as Reservation['timeSlot'])}
                required aria-invalid={Boolean(fieldErrors.timeSlot)} className={inp}>
                {TIME_SLOTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              {fieldErrors.timeSlot && <p className={fieldError}>{fieldErrors.timeSlot}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">コース *</label>
            <select value={form.courseId} onChange={(e) => set('courseId', e.target.value)}
              required aria-invalid={Boolean(fieldErrors.courseId)} className={inp}>
              {COURSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {fieldErrors.courseId && <p className={fieldError}>{fieldErrors.courseId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">代表者氏名 *</label>
            <input type="text" value={form.guestName} onChange={(e) => set('guestName', e.target.value)}
              placeholder="田中 花子" maxLength={50} required aria-invalid={Boolean(fieldErrors.guestName)} className={inp} />
            {fieldErrors.guestName && <p className={fieldError}>{fieldErrors.guestName}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">人数 *</label>
              <input type="number" min={1} max={20} value={form.guestCount}
                onChange={(e) => set('guestCount', Number(e.target.value))}
                required step={1} aria-invalid={Boolean(fieldErrors.guestCount)} className={inp} />
              {fieldErrors.guestCount && <p className={fieldError}>{fieldErrors.guestCount}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">予約取込元</label>
              <select value={form.channel}
                onChange={(e) => set('channel', e.target.value as Reservation['channel'])} className={inp}>
                <option value="hp">HP手動入力</option>
                <option value="email">メール</option>
                <option value="phone">電話</option>
              </select>
              {fieldErrors.channel && <p className={fieldError}>{fieldErrors.channel}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">予約ステータス *</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)}
              required aria-invalid={Boolean(fieldErrors.status)} className={inp}>
              {STATUSES.filter((status) => ['STS-01', 'STS-02', 'STS-03'].includes(status.id)).map((status) => (
                <option key={status.id} value={status.id}>{status.name}</option>
              ))}
            </select>
            {fieldErrors.status && <p className={fieldError}>{fieldErrors.status}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">諡・ｽ薙せ繧ｿ繝・ヵ</label>
            <select value={form.staffId} onChange={(e) => set('staffId', e.target.value)}
              aria-invalid={Boolean(fieldErrors.staffId)} className={inp}>
              <option value="">指定なし</option>
              {STAFF.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select>
            {fieldErrors.staffId && <p className={fieldError}>{fieldErrors.staffId}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">電話番号 *</label>
              <input type="tel" value={form.guestPhone} onChange={(e) => set('guestPhone', e.target.value)}
                placeholder="090-0000-0000" maxLength={20} pattern="[0-9-]+" required
                aria-invalid={Boolean(fieldErrors.guestPhone)} className={inp} />
              {fieldErrors.guestPhone && <p className={fieldError}>{fieldErrors.guestPhone}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス *</label>
              <input type="email" value={form.guestEmail} onChange={(e) => set('guestEmail', e.target.value)}
                placeholder="guest@example.com" maxLength={100} required
                aria-invalid={Boolean(fieldErrors.guestEmail)} className={inp} />
              {fieldErrors.guestEmail && <p className={fieldError}>{fieldErrors.guestEmail}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">スタッフメモ</label>
            <textarea value={form.staffNote} onChange={(e) => set('staffNote', e.target.value)}
              placeholder="特記事項など" rows={3} maxLength={500}
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
const fieldError = 'text-xs text-red-600 mt-1'
