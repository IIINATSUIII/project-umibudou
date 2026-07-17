'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchCustomers, patchCustomer } from '@/lib/api'
import type { Customer } from '@/types'

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const user = useAuth()
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [editing, setEditing] = useState(false)
  const [guideNote, setGuideNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    fetchCustomers().then((data) => {
      const c = data.find((x) => x.id === id)
      if (!c) { router.push('/customers'); return }
      setCustomer(c)
      setGuideNote(c.guideNotes)
    })
  }, [id, user, router])

  async function handleSaveNote() {
    if (!customer) return
    setSaving(true)
    await patchCustomer(customer.id, { guideNotes: guideNote })
    setCustomer((c) => c ? { ...c, guideNotes: guideNote } : c)
    setSaving(false)
    setEditing(false)
  }

  if (!customer) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
          <h1 className="text-xl font-bold text-gray-800">顧客詳細</h1>
        </div>

        <div className="bg-ocean-700 text-white rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold">
              {customer.lastName.slice(0, 1)}
            </div>
            <div>
              <p className="text-xl font-bold">{customer.lastName} {customer.firstName}</p>
              <p className="text-white/70 text-sm">{customer.lastNameKana} {customer.firstNameKana}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: '来店回数', value: `${customer.visitCount}回` },
              { label: '最終来店', value: customer.lastVisit },
              { label: '総本数', value: customer.totalDives ? `${customer.totalDives}本` : '未記録' },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 rounded-lg p-2.5 text-center">
                <p className="text-xs text-white/60">{s.label}</p>
                <p className="font-semibold text-sm mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700 mb-2">📞 連絡先</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-20">電話番号</span>
            <span className="text-sm font-mono text-ocean-600">{customer.phone}</span>
          </div>
          {customer.email && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-20">メール</span>
              <span className="text-sm text-ocean-600">{customer.email}</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">🎓 スキル・資格</p>
          {customer.hasCCard ? (
            <div className="flex items-center gap-2">
              <span className="bg-teal-50 text-teal-700 border border-teal-200 text-sm px-3 py-1 rounded-lg font-medium">
                {customer.cCardType}
              </span>
              <span className="text-sm text-gray-500">総本数 {customer.totalDives}本</span>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Cカードなし</p>
          )}
        </div>

        {customer.healthNotes && customer.healthNotes !== '特記なし' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-red-700 mb-1">⚠️ 健康・注意事項</p>
            <p className="text-sm text-red-700">{customer.healthNotes}</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">📝 ガイドメモ</p>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-xs text-ocean-600 hover:text-ocean-700 font-medium">編集</button>
            )}
          </div>
          {editing ? (
            <>
              <textarea value={guideNote} onChange={(e) => setGuideNote(e.target.value)}
                rows={5} placeholder="次回ガイド向けのメモを残す..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 resize-none" />
              <div className="flex gap-2">
                <button onClick={() => { setEditing(false); setGuideNote(customer.guideNotes) }}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">
                  キャンセル
                </button>
                <button onClick={handleSaveNote} disabled={saving}
                  className="flex-1 bg-ocean-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-ocean-700 disabled:opacity-50 transition-colors">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap min-h-[60px]">
              {customer.guideNotes || <span className="text-gray-400 italic">メモなし</span>}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
