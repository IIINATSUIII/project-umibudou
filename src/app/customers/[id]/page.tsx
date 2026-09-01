'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchCustomers, patchCustomer } from '@/lib/api'
import { MSG } from '@/lib/messages'
import {
  C_CARD_TYPES,
  validateCustomerUpdate,
  type CustomerFieldErrors,
} from '@/lib/customerValidation'
import type { Customer } from '@/types'

/** 編集フォームの入力値（数値もいったん文字列で保持する） */
interface ProfileForm {
  lastName: string
  firstName: string
  lastNameKana: string
  firstNameKana: string
  phone: string
  email: string
  hasCCard: boolean
  cCardType: string
  totalDives: string
  healthNotes: string
}

function toForm(c: Customer): ProfileForm {
  return {
    lastName: c.lastName,
    firstName: c.firstName,
    lastNameKana: c.lastNameKana,
    firstNameKana: c.firstNameKana,
    phone: c.phone,
    email: c.email,
    hasCCard: c.hasCCard,
    cCardType: c.cCardType,
    totalDives: String(c.totalDives ?? 0),
    healthNotes: c.healthNotes,
  }
}

function toDelta(f: ProfileForm): Partial<Customer> {
  return {
    lastName: f.lastName.trim(),
    firstName: f.firstName.trim(),
    lastNameKana: f.lastNameKana.trim(),
    firstNameKana: f.firstNameKana.trim(),
    phone: f.phone.trim(),
    email: f.email.trim(),
    hasCCard: f.hasCCard,
    // Cカードなしにした場合は種別が残らないよう空にする
    cCardType: f.hasCCard ? f.cCardType : '',
    totalDives: f.totalDives.trim() === '' ? 0 : Number(f.totalDives),
    healthNotes: f.healthNotes.trim(),
  }
}

/** 最終更新日時（ISO）を画面表示用に整形 */
function formatUpdatedAt(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
}

const INPUT_CLASS =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500'

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const user = useAuth()
  const router = useRouter()
  const [customer, setCustomer] = useState<Customer | null>(null)

  // 編集状態
  const [editingProfile, setEditingProfile] = useState(false)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [guideNote, setGuideNote] = useState('')

  // 保存結果の表示
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({})
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  /** 更新競合（MSG-20）。再送する差分を保持して「上書き保存」に備える */
  const [conflict, setConflict] = useState<{ delta: Partial<Customer>; latest: Customer } | null>(null)

  const applyCustomer = useCallback((c: Customer) => {
    setCustomer(c)
    setForm(toForm(c))
    setGuideNote(c.guideNotes)
  }, [])

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    fetchCustomers().then((data) => {
      const c = data.find((x) => x.id === id)
      if (!c) { router.push('/customers'); return }
      applyCustomer(c)
    })
  }, [id, user, router, applyCustomer])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

  /** 差分を保存する。バリデーションエラー・更新競合は画面に出し分ける */
  async function save(delta: Partial<Customer>, options: { force?: boolean } = {}) {
    if (!customer) return
    setSaving(true)
    setFormError('')

    const res = await patchCustomer(customer.id, delta, {
      expectedUpdatedAt: customer.updatedAt ?? '',
      force: options.force,
    })
    setSaving(false)

    switch (res.status) {
      case 'ok':
        applyCustomer(res.customer)
        setFieldErrors({})
        setConflict(null)
        setEditingProfile(false)
        setEditingNote(false)
        setToast(res.message || MSG.SAVED)
        break
      case 'invalid':
        setFieldErrors(res.fields)
        setFormError(res.message)
        break
      case 'conflict':
        setConflict({ delta, latest: res.customer })
        break
      case 'error':
        setFormError(res.message)
        break
    }
  }

  function handleSaveProfile() {
    if (!customer || !form) return
    const delta = toDelta(form)
    // サーバーと同じ関数で先に検証し、明らかな入力ミスは往復せずに指摘する
    const errors = validateCustomerUpdate(delta, customer)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setFormError('入力内容を確認してください。')
      return
    }
    save(delta)
  }

  function cancelProfileEdit() {
    if (customer) setForm(toForm(customer))
    setEditingProfile(false)
    setFieldErrors({})
    setFormError('')
    setConflict(null)
  }

  /** 競合時に最新の内容を読み込み直す（編集中の内容は破棄） */
  function reloadLatest() {
    if (!conflict) return
    applyCustomer(conflict.latest)
    setConflict(null)
    setFormError('')
    setFieldErrors({})
  }

  if (!customer || !form) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>
  }

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

        {/* 更新競合（MSG-20）：後勝ちで上書きするか、最新を読み込むか選ぶ */}
        {conflict && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
            <p className="text-sm text-amber-800">⚠️ {MSG.CONFLICT}</p>
            <p className="text-xs text-amber-700">
              最新の更新日時：{formatUpdatedAt(conflict.latest.updatedAt)}
            </p>
            <div className="flex gap-2">
              <button onClick={reloadLatest} disabled={saving}
                className="flex-1 border border-amber-400 text-amber-800 py-2 rounded-lg text-sm hover:bg-amber-100 disabled:opacity-50">
                最新の内容を読み込む
              </button>
              <button onClick={() => save(conflict.delta, { force: true })} disabled={saving}
                className="flex-1 bg-amber-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                {saving ? '保存中…' : 'このまま上書き保存'}
              </button>
            </div>
          </div>
        )}

        {/* 基本情報（表示／編集） */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">📇 基本情報</p>
            {!editingProfile && (
              <button onClick={() => { setEditingProfile(true); setFormError(''); setFieldErrors({}) }}
                className="text-xs text-ocean-600 hover:text-ocean-700 font-medium">編集</button>
            )}
          </div>

          {editingProfile ? (
            <div className="space-y-3">
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="姓（漢字）" error={fieldErrors.lastName}>
                  <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className={INPUT_CLASS} />
                </Field>
                <Field label="名（漢字）" error={fieldErrors.firstName}>
                  <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className={INPUT_CLASS} />
                </Field>
                <Field label="姓（カナ）" error={fieldErrors.lastNameKana}>
                  <input value={form.lastNameKana} onChange={(e) => setForm({ ...form, lastNameKana: e.target.value })}
                    className={INPUT_CLASS} placeholder="サトウ" />
                </Field>
                <Field label="名（カナ）" error={fieldErrors.firstNameKana}>
                  <input value={form.firstNameKana} onChange={(e) => setForm({ ...form, firstNameKana: e.target.value })}
                    className={INPUT_CLASS} placeholder="イチロウ" />
                </Field>
              </div>

              <Field label="電話番号" error={fieldErrors.phone}>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  type="tel" inputMode="tel" className={INPUT_CLASS} placeholder="090-1234-5678" />
              </Field>

              <Field label="メールアドレス" error={fieldErrors.email}>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  type="email" inputMode="email" className={INPUT_CLASS} placeholder="guest@example.com" />
              </Field>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.hasCCard}
                  onChange={(e) => setForm({ ...form, hasCCard: e.target.checked })}
                  className="w-4 h-4 accent-ocean-600" />
                Cカードあり
              </label>

              {form.hasCCard && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Cカード種別" error={fieldErrors.cCardType}>
                    <select value={form.cCardType} onChange={(e) => setForm({ ...form, cCardType: e.target.value })}
                      className={INPUT_CLASS}>
                      <option value="">選択してください</option>
                      {C_CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="総ダイビング本数" error={fieldErrors.totalDives}>
                    <input value={form.totalDives} onChange={(e) => setForm({ ...form, totalDives: e.target.value })}
                      type="number" min={0} className={INPUT_CLASS} />
                  </Field>
                </div>
              )}

              <Field label="備考・アレルギー" error={fieldErrors.healthNotes}>
                <textarea value={form.healthNotes} onChange={(e) => setForm({ ...form, healthNotes: e.target.value })}
                  rows={3} placeholder="既往歴・食物アレルギー・特記事項など"
                  className={`${INPUT_CLASS} resize-none`} />
              </Field>

              <div className="flex gap-2 pt-1">
                <button onClick={cancelProfileEdit} disabled={saving}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                  キャンセル
                </button>
                <button onClick={handleSaveProfile} disabled={saving}
                  className="flex-1 bg-ocean-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-ocean-700 disabled:opacity-50 transition-colors">
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">氏名</span>
                <span className="text-sm text-gray-800">{customer.lastName} {customer.firstName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">ふりがな</span>
                <span className="text-sm text-gray-800">{customer.lastNameKana} {customer.firstNameKana}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">電話番号</span>
                <span className="text-sm font-mono text-ocean-600">{customer.phone}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">メール</span>
                <span className="text-sm text-ocean-600">{customer.email || <span className="text-gray-400">未登録</span>}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-24 shrink-0">最終更新</span>
                <span className="text-xs text-gray-500">{formatUpdatedAt(customer.updatedAt)}</span>
              </div>
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
            <p className="text-sm text-red-700 whitespace-pre-wrap">{customer.healthNotes}</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">📝 ガイドメモ</p>
            {!editingNote && (
              <button onClick={() => setEditingNote(true)} className="text-xs text-ocean-600 hover:text-ocean-700 font-medium">編集</button>
            )}
          </div>
          {editingNote ? (
            <>
              <textarea value={guideNote} onChange={(e) => setGuideNote(e.target.value)}
                rows={5} placeholder="次回ガイド向けのメモを残す..."
                className={`${INPUT_CLASS} resize-none`} />
              {fieldErrors.guideNotes && <p className="text-xs text-red-600">{fieldErrors.guideNotes}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setEditingNote(false); setGuideNote(customer.guideNotes); setFieldErrors({}) }}
                  disabled={saving}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
                  キャンセル
                </button>
                <button onClick={() => save({ guideNotes: guideNote.trim() })} disabled={saving}
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

      {/* MSG-13 保存完了 */}
      {toast && (
        <div role="status"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          ✅ {toast}
        </div>
      )}
    </div>
  )
}
