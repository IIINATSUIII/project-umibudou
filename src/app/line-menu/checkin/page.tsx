'use client'

import { useState } from 'react'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'

type CheckinParticipant = { name: string; token?: string; expiresAt?: string; used: boolean }
type LookupResult = {
  reservation: { diveDate: string; time?: string; timeSlot: string; courseName: string; guestCount: number }
  participants: CheckinParticipant[]
  questionnaireUrl?: string
  incompleteCount: number
}

export default function CheckinQrPage() {
  const [reservationId, setReservationId] = useState('')
  const [reservationToken, setReservationToken] = useState('')
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function findReservation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const response = await fetch('/api/public/checkin-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, reservationToken }),
      })
      const data = await response.json() as LookupResult & { error?: string }
      if (!response.ok) throw new Error(data.error ?? '予約を確認できませんでした。')
      setResult(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '予約を確認できませんでした。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu" className="text-sm font-medium text-teal-800 hover:underline">← メニューへ</Link>
        <header className="mb-6 mt-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-3xl text-white shadow">▦</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">チェックインQR</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">予約完了時の案内リンクにある予約番号と予約確認コードを入力してください。</p>
        </header>

        <form onSubmit={findReservation} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium text-slate-700">
            予約番号
            <input value={reservationId} onChange={(event) => setReservationId(event.target.value)} required maxLength={64}
              autoComplete="off" placeholder="予約時に案内された番号" className={inputClass} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            予約確認コード
            <input value={reservationToken} onChange={(event) => setReservationToken(event.target.value)} required maxLength={128}
              autoComplete="off" placeholder="予約完了時の案内リンクに含まれるコード" className={`${inputClass} font-mono`} />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={loading || !reservationId.trim() || !reservationToken.trim()}
            className="w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? '予約を確認中…' : '受付QRを表示'}
          </button>
        </form>

        {result && (
          <section className="mt-5 space-y-4" aria-live="polite">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="font-semibold text-slate-900">{result.reservation.diveDate}　{result.reservation.time ?? result.reservation.timeSlot}</p>
              <p className="mt-1 text-sm text-slate-600">{result.reservation.courseName} · {result.reservation.guestCount}名</p>
            </div>
            {result.participants.filter((participant) => participant.token && !participant.used).map((participant) => (
              <article key={`${participant.name}-${participant.token}`} className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
                <h2 className="font-bold text-slate-900">{participant.name} 様</h2>
                <div className="mt-4 flex justify-center rounded-xl bg-white py-2">
                  <QRCodeSVG value={participant.token!} size={220} level="M" includeMargin />
                </div>
                <p className="mt-3 text-sm font-medium text-teal-800">受付でこのQRを提示してください</p>
                {participant.expiresAt && <p className="mt-1 text-xs text-slate-500">有効期限：{new Date(participant.expiresAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>}
              </article>
            ))}
            {result.participants.length > 0 && result.participants.every((participant) => participant.used) && result.incompleteCount === 0 && (
              <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">この予約の参加者は全員受付済みです。</p>
            )}
            {result.incompleteCount > 0 && result.questionnaireUrl && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">問診票が未提出の参加者がいます（{result.incompleteCount}名）</p>
                <p className="mt-1">問診票を提出すると、参加者ごとの受付QRが表示されます。</p>
                <a href={result.questionnaireUrl} className="mt-3 inline-flex font-semibold underline">問診票を入力する</a>
              </div>
            )}
            {result.participants.length > 0 && !result.participants.some((participant) => participant.token && !participant.used) && !result.participants.every((participant) => participant.used) && result.incompleteCount === 0 && (
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">受付QRの有効期限が切れている可能性があります。ショップへお問い合わせください。</p>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100'
