'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import {
  clearSavedCheckins,
  loadSavedCheckins,
  parseCheckinInput,
  readCheckinParams,
  saveCheckin,
  type CheckinCredential,
} from '@/lib/checkinLink'

type CheckinParticipant = { name: string; token?: string; expiresAt?: string; used: boolean }
type LookupResult = {
  reservation: { diveDate: string; time?: string; timeSlot: string; courseName: string; guestCount: number }
  participants: CheckinParticipant[]
  questionnaireUrl?: string
  incompleteCount: number
}
type LookupOutcome = { ok: true; data: LookupResult } | { ok: false; error: string }

const DEFAULT_ERROR = '予約を確認できませんでした。'

async function fetchCheckin(credential: CheckinCredential): Promise<LookupOutcome> {
  try {
    const response = await fetch('/api/public/checkin-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })
    const data = await response.json() as LookupResult & { error?: string }
    if (!response.ok) return { ok: false, error: data.error ?? DEFAULT_ERROR }
    return { ok: true, data }
  } catch {
    return { ok: false, error: '通信に失敗しました。電波の良い場所で再度お試しください。' }
  }
}

function storage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function CheckinQr() {
  const searchParams = useSearchParams()
  const [input, setInput] = useState('')
  const [results, setResults] = useState<LookupResult[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const started = useRef(false)

  /** 複数の予約をまとめて確認する。1件でも表示できれば、表示できなかった分のエラーは出さない。 */
  const lookup = useCallback(async (credentials: CheckinCredential[]) => {
    setError('')
    setResults([])
    setLoading(true)
    const outcomes = await Promise.all(credentials.map(fetchCheckin))
    const shown = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.data] : []))
    setResults(shown)
    if (shown.length === 0) {
      const failed = outcomes.find((outcome) => !outcome.ok)
      setError(failed && !failed.ok ? failed.error : DEFAULT_ERROR)
    }
    // 表示できた予約は、次回から入力なしで開けるようこの端末に保存する
    outcomes.forEach((outcome, index) => {
      const credential = credentials[index]
      if (outcome.ok && credential.reservationId) {
        saveCheckin(storage(), {
          reservationId: credential.reservationId,
          reservationToken: credential.reservationToken,
          diveDate: outcome.data.reservation.diveDate,
        })
      }
    })
    setSavedCount(loadSavedCheckins(storage()).length)
    setLoading(false)
  }, [])

  // 開いたら、入力なしで受付QRを表示する（リンクの内容 → この端末に保存した予約 の順）
  useEffect(() => {
    if (started.current) return
    started.current = true
    const fromLink = readCheckinParams(searchParams)
    if (fromLink) {
      void lookup([fromLink])
      return
    }
    const saved = loadSavedCheckins(storage())
    setSavedCount(saved.length)
    if (saved.length > 0) {
      void lookup(saved.map(({ reservationId, reservationToken }) => ({ reservationId, reservationToken })))
    }
  }, [searchParams, lookup])

  function findReservation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const credential = parseCheckinInput(input)
    if (!credential) {
      setResults([])
      setError('入力内容を読み取れませんでした。ショップから届いたリンク、または確認コードをそのまま貼り付けてください。')
      return
    }
    void lookup([credential])
  }

  function forgetSaved() {
    clearSavedCheckins(storage())
    setSavedCount(0)
    setResults([])
    setError('')
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu" className="text-sm font-medium text-teal-800 hover:underline">← メニューへ</Link>
        <header className="mb-6 mt-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-3xl text-white shadow">▦</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">チェックインQR</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            このスマホで予約された内容を、自動で表示します。問診票の提出とショップの確定のあとに、QRが表示されます。
          </p>
        </header>

        {loading && <p role="status" className="mb-4 text-center text-sm text-slate-600">予約を確認中…</p>}
        {error && !loading && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {results.length > 0 && (
          <section className="space-y-6" aria-live="polite">
            {results.map((result, index) => (
              <div key={`${result.reservation.diveDate}-${index}`} className="space-y-4">
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
              </div>
            ))}
          </section>
        )}

        <details className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" open={!loading && results.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">表示されないとき・別の予約を確認する</summary>
          <form onSubmit={findReservation} className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              ショップから届いたリンク、または確認コード
              <textarea value={input} onChange={(event) => setInput(event.target.value)} required rows={3} maxLength={600}
                autoComplete="off" placeholder="リンクをそのまま貼り付けてください" className={`${inputClass} font-mono text-sm`} />
            </label>
            <button type="submit" disabled={loading || !input.trim()}
              className="w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? '予約を確認中…' : '受付QRを表示'}
            </button>
          </form>
          {savedCount > 0 && (
            <button type="button" onClick={forgetSaved} className="mt-4 text-xs text-slate-500 underline">
              このスマホに保存した予約を削除する
            </button>
          )}
        </details>
      </div>
    </main>
  )
}

export default function CheckinQrPage() {
  return (
    <Suspense>
      <CheckinQr />
    </Suspense>
  )
}

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100'
