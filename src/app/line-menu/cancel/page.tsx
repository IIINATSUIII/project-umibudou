'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { readCheckinParams } from '@/lib/checkinLink'
import {
  CANCELLATION_REQUEST_CUTOFF_HOUR_JST,
  CANCELLATION_REQUEST_NOTE_MAX_LENGTH,
  type PublicCancellationView,
} from '@/lib/cancellationRequest'

type Credential = { reservationId: string; reservationToken: string }
type RequestResult = PublicCancellationView & { ok?: boolean; alreadyRequested?: boolean; error?: string }

const TIME_SLOT_LABELS: Record<string, string> = {
  morning: '午前', afternoon: '午後', full: '1日', unspecified: '時間指定なし',
}
const STATE_LABELS: Record<PublicCancellationView['reservation']['state'], string> = {
  requested: '仮予約（ショップ確認中）',
  confirmed: '予約確定',
  cancelled: 'キャンセル済み',
  closed: '受付終了',
}

function formatDateTime(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

async function callApi(body: Record<string, unknown>): Promise<{ status: number; data: RequestResult }> {
  const response = await fetch('/api/public/cancellation-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({})) as RequestResult
  return { status: response.status, data }
}

function CancelRequest() {
  const searchParams = useSearchParams()
  const [credential, setCredential] = useState<Credential | null>(null)
  const [form, setForm] = useState<Credential>({ reservationId: '', reservationToken: '' })
  const [view, setView] = useState<PublicCancellationView | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  const lookup = useCallback(async (next: Credential) => {
    setLoading(true)
    setError('')
    setView(null)
    setSubmitted(false)
    try {
      const { status, data } = await callApi({ action: 'status', ...next })
      if (status !== 200) {
        setError(data.error ?? '予約を確認できませんでした。')
        return
      }
      setCredential(next)
      setView(data)
    } catch {
      setError('通信に失敗しました。電波の良い場所で再度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    const fromLink = readCheckinParams(searchParams)
    if (fromLink) void lookup(fromLink)
  }, [searchParams, lookup])

  function submitLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = { reservationId: form.reservationId.trim(), reservationToken: form.reservationToken.trim() }
    if (!next.reservationId || !next.reservationToken) return
    void lookup(next)
  }

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!credential || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const { status, data } = await callApi({ action: 'request', ...credential, note })
      if (data.reservation) setView(data)
      if (status === 200 && data.ok) {
        setSubmitted(true)
        return
      }
      setError(data.error ?? 'キャンセル申請を送信できませんでした。キャンセルは成立していません。')
    } catch {
      setError('通信に失敗しました。キャンセル申請は届いていない可能性があります。電波の良い場所で、もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  const pending = view?.request?.status === 'pending'

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu" className="text-sm font-medium text-teal-800 hover:underline">← メニューへ</Link>
        <header className="mb-6 mt-5">
          <h1 className="text-2xl font-bold text-slate-900">予約のキャンセル申請</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            ここから送るのは<strong className="font-semibold text-slate-800">申請</strong>です。ショップが内容を確認してご連絡した時点で、キャンセルが成立します。
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Webでの申請はダイブ日の前日{CANCELLATION_REQUEST_CUTOFF_HOUR_JST}:00までです。それ以降や当日は、ショップへお電話ください。
          </p>
        </header>

        {loading && <p role="status" className="mb-4 text-sm text-slate-600">予約を確認中…</p>}
        {error && !loading && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {view && (
          <section aria-live="polite" className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-900">
                {view.reservation.diveDate}　{view.reservation.time ?? TIME_SLOT_LABELS[view.reservation.timeSlot] ?? ''}
              </p>
              <p className="mt-1 text-sm text-slate-600">{view.reservation.courseName} · {view.reservation.guestCount}名</p>
              <p className="mt-2 text-xs text-slate-500">予約の状態：{STATE_LABELS[view.reservation.state]}</p>
            </div>

            {(submitted || pending) && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">{submitted ? 'キャンセル申請を受け付けました' : 'キャンセル申請を受け付けています'}</p>
                <p className="mt-1 leading-relaxed">
                  まだキャンセルは成立していません。ショップが確認してご連絡します。
                  {view.request?.requestedAt && `（申請日時：${formatDateTime(view.request.requestedAt)}）`}
                </p>
                <p className="mt-2 leading-relaxed">ダイブ日が近い場合や、取り消したい場合はショップへお電話ください。</p>
              </div>
            )}

            {view.request?.status === 'approved' && (
              <p className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">ショップがキャンセルを確定しました。</p>
            )}

            {!submitted && !pending && !view.canRequest && view.message && (
              <p className="rounded-2xl bg-slate-100 p-4 text-sm leading-relaxed text-slate-700">{view.message}</p>
            )}

            {!submitted && view.canRequest && (
              <form onSubmit={submitRequest} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                {view.deadline && (
                  <p className="text-sm text-slate-700">Web申請の期限：<span className="font-semibold">{formatDateTime(view.deadline)}</span></p>
                )}
                <label className="block text-sm font-medium text-slate-700">
                  キャンセルの理由（任意）
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3}
                    maxLength={CANCELLATION_REQUEST_NOTE_MAX_LENGTH}
                    placeholder="例：体調不良のため、日程の都合がつかなくなったため"
                    className={inputClass} />
                </label>
                <p className="text-xs leading-relaxed text-slate-500">
                  キャンセル料はショップの規定に従います。海況による中止は、ショップからご連絡します。
                </p>
                <button type="submit" disabled={submitting}
                  className="w-full rounded-xl bg-rose-700 px-4 py-3 font-semibold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {submitting ? '送信中…' : 'キャンセルを申請する'}
                </button>
              </form>
            )}
          </section>
        )}

        {!view && !loading && (
          <form onSubmit={submitLookup} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">予約完了画面に表示された予約番号と確認コードを入力してください。</p>
            <label className="block text-sm font-medium text-slate-700">
              予約番号
              <input value={form.reservationId} onChange={(event) => setForm((f) => ({ ...f, reservationId: event.target.value }))}
                required maxLength={64} autoComplete="off" className={`${inputClass} font-mono`} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              確認コード
              <input value={form.reservationToken} onChange={(event) => setForm((f) => ({ ...f, reservationToken: event.target.value }))}
                required maxLength={128} autoComplete="off" className={`${inputClass} font-mono`} />
            </label>
            <button type="submit" disabled={!form.reservationId.trim() || !form.reservationToken.trim()}
              className="w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
              予約を確認する
            </button>
            <p className="text-xs leading-relaxed text-slate-500">予約番号や確認コードがわからない場合は、ショップへお電話ください。</p>
          </form>
        )}
      </div>
    </main>
  )
}

export default function CancelRequestPage() {
  return (
    <Suspense>
      <CancelRequest />
    </Suspense>
  )
}

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100'
