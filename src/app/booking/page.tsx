'use client'

import { useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

const COURSES = [
  '体験ダイビング',
  'ファンダイビング（2本）',
  'ファンダイビング（3本）',
  'ナイトダイビング',
  'シュノーケリング',
  'その他',
]

export default function BookingPage() {
  const [form, setForm] = useState({
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: '09:00',
    course: '体験ダイビング',
    guestName: '',
    guestCount: 1,
    phone: '',
    notes: '',
  })
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [resId, setResId] = useState('')
  const [error, setError] = useState('')

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSending(true)
    const res = await fetch('/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSending(false)
    if (res.ok) {
      const data = await res.json()
      setResId(data.id)
      setDone(true)
      window.scrollTo(0, 0)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? '送信に失敗しました。時間をおいて再度お試しください。')
    }
  }

  function downloadQr() {
    const canvas = document.getElementById('booking-qr') as HTMLCanvasElement | null
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `予約QR_${resId}.png`
    a.click()
  }

  if (done) {
    // QRには問診票入力ページのURLを埋め込む（当日スタッフが読み取る／事前入力にも使える）
    const qrUrl = `${window.location.origin}/questionnaire/${resId}`
    return (
      <div className="min-h-screen bg-gradient-to-b from-ocean-700 to-ocean-500 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4">🌊</div>
          <h1 className="text-xl font-bold text-gray-800 mb-3">お申し込みを受け付けました</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            この時点では<span className="font-semibold">仮予約</span>です。
            スタッフが内容を確認のうえ、お電話にて確定のご連絡をいたします。
          </p>

          <div className="mt-6 bg-gray-50 rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-500 mb-1">予約番号</p>
            <p className="font-mono font-bold text-gray-800 mb-4">{resId}</p>
            <div className="flex justify-center">
              <QRCodeCanvas id="booking-qr" value={qrUrl} size={180} includeMargin />
            </div>
            <div className="text-left text-sm text-gray-700 mt-4 space-y-1">
              <p>📅 {form.date} {form.time}</p>
              <p>🤿 {form.course}</p>
              <p>👤 {form.guestName} 様（{form.guestCount}名）</p>
            </div>
            <p className="text-xs text-gray-500 mt-4 leading-relaxed">
              このQRはあなたの予約ページ（問診票入力）につながります。
              スクリーンショットまたは下のボタンで保存し、当日スタッフにご提示ください。
              問診票は事前のご入力も可能です。
            </p>
            <button onClick={downloadQr}
              className="mt-4 w-full bg-ocean-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-ocean-700 transition-colors">
              ⬇ QRコードを保存する
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-6">
            ご不明な点はお電話にてお問い合わせください。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-ocean-700 to-ocean-500 py-8 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🤿</div>
          <h1 className="text-xl font-bold text-gray-800">ダイビング予約申し込み</h1>
          <p className="text-sm text-gray-500 mt-1">
            スタッフ確認後に確定のご連絡をいたします
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">希望日 *</label>
              <input type="date" value={form.date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => set('date', e.target.value)} required className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">希望時間 *</label>
              <input type="time" value={form.time}
                onChange={(e) => set('time', e.target.value)} required className={inp} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">コース *</label>
            <select value={form.course} onChange={(e) => set('course', e.target.value)} className={inp}>
              {COURSES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">お名前 *</label>
            <input type="text" value={form.guestName}
              onChange={(e) => set('guestName', e.target.value)}
              placeholder="田中 花子" required className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">人数 *</label>
              <input type="number" min={1} max={20} value={form.guestCount}
                onChange={(e) => set('guestCount', Number(e.target.value))} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">電話番号 *</label>
              <input type="tel" value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="090-0000-0000" required className={inp} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ご要望・メモ</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
              placeholder="ライセンスの有無、送迎希望など" rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 resize-none" />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button type="submit" disabled={sending}
            className="w-full bg-ocean-600 text-white py-3 rounded-lg font-medium text-sm hover:bg-ocean-700 transition-colors disabled:opacity-50">
            {sending ? '送信中…' : 'この内容で申し込む'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500'
