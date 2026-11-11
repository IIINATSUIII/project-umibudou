'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Item = { id: string; questionnaireId: string; name: string; createdAt: string }

export default function CheckinInbox({ onSelect, disabled, refreshKey }: {
  onSelect: (id: string) => Promise<void>
  disabled: boolean
  refreshKey: number
}) {
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let interval = 5000
    async function poll() {
      try {
        if (!document.hidden) {
          const response = await fetch('/api/checkin-handoff', { cache: 'no-store', signal: controller.signal })
          if (response.redirected || response.status === 401) throw new Error('ログインし直してください。')
          if (!response.ok) throw new Error('受付待ちを取得できません。通信状態を確認してください。')
          const data = await response.json() as { items: Item[]; pollIntervalMs?: number }
          interval = data.pollIntervalMs === 15000 ? 15000 : 5000
          if (!controller.signal.aborted) { setItems(data.items); setError(''); setIntervalSeconds(interval / 1000) }
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '受付待ちを取得できません。')
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, interval)
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [refreshKey])

  async function select(id: string) {
    setBusy(true)
    try { await onSelect(id) } finally { setBusy(false) }
  }

  return <section className="bg-white rounded-xl border p-4 space-y-3" aria-label="スマホからの受付待ち">
    <h2 className="font-bold text-gray-800">スマホからの受付待ち</h2>
    <p className="text-xs text-gray-500">店舗内で共有・{intervalSeconds}秒ごとに更新。対象者を選び、問診確認後に名簿へ追加してください。</p>
    <Link href="/checkin/mobile" className="inline-block text-sm text-ocean-700 underline">店舗スマホ用のQR読取画面を開く</Link>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!error && items.length === 0 && <p className="text-sm text-gray-500">受付待ちはありません。</p>}
    <ul className="divide-y">{items.map(item => <li key={item.id}>
      <button type="button" disabled={disabled || busy} onClick={() => void select(item.questionnaireId)}
        className="w-full text-left py-3 text-sm disabled:opacity-50">
        <span className="font-semibold">{item.name} 様</span>
        <span className="ml-3 text-gray-500">{new Date(item.createdAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })}</span>
        <span className="block text-ocean-700">問診を確認 →</span>
      </button>
    </li>)}</ul>
  </section>
}
