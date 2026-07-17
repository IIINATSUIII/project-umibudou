'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import type { QuestionnaireData } from '@/types'

type Step = 'intro' | 'basic' | 'health' | 'today' | 'experience' | 'agree' | 'done'
const STEPS: Step[] = ['intro', 'basic', 'health', 'today', 'experience', 'agree', 'done']
const STEP_LABELS = ['はじめに', '基本情報', '健康状態', '当日体調', '経験・スキル', '同意事項', '完了']

const BLANK: Omit<QuestionnaireData, 'id' | 'reservationId' | 'submittedAt'> = {
  lastName: '', firstName: '', lastNameKana: '', firstNameKana: '',
  birthDate: '', gender: 'male', address: '', phone: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  heartDisease: false, respiratoryDisease: false, earDisease: false,
  epilepsy: false, diabetes: false, pregnant: false, panicDisorder: false,
  medication: false, medicationName: '', latexAllergy: false,
  sleepHours: 7, alcoholLastNight: false, alcoholToday: false, condition: 'good',
  flightWithin48h: false,
  hasCCard: false, cCardType: '', cCardOrg: '', lastDiveDate: '', totalDives: 0,
  agreeRisk: false, agreeMedical: false, agreePhoto: false,
}

export default function QuestionnairePage() {
  const { id } = useParams<{ id: string }>()
  const [step, setStep] = useState<Step>('intro')
  const [form, setForm] = useState(BLANK)
  const [qId, setQId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function next() {
    const idx = STEPS.indexOf(step)
    setStep(STEPS[idx + 1])
    window.scrollTo(0, 0)
  }
  function prev() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  async function handleSubmit() {
    setSubmitting(true)

    // 予約への紐付け・顧客台帳への反映はサーバー側（公開API）で行う
    const res = await fetch('/api/public/questionnaires', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservationId: id, ...form }),
    })
    setSubmitting(false)

    if (!res.ok) {
      alert('送信に失敗しました。時間をおいて再度お試しください。')
      return
    }

    const data = await res.json()
    setQId(data.questionnaireId)
    setStep('done')
    window.scrollTo(0, 0)
  }

  const stepIdx = STEPS.indexOf(step)
  const progress = Math.round((stepIdx / (STEPS.length - 1)) * 100)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-ocean-700 text-white px-4 py-4">
        <div className="max-w-lg mx-auto">
          <h1 className="text-base font-bold">🤿 ダイビング問診票</h1>
          {step !== 'done' && step !== 'intro' && (
            <>
              <div className="mt-2 bg-white/20 rounded-full h-1.5">
                <div className="bg-white rounded-full h-1.5 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs mt-1 text-white/70">
                {STEP_LABELS[stepIdx]}（{stepIdx} / {STEPS.length - 2}）
              </p>
            </>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">

        {step === 'intro' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800 text-lg">問診票の入力をお願いします</h2>
            <p className="text-sm text-gray-600">安全なダイビングのため、健康状態と経験についてお教えください。</p>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>⏱ 所要時間：約5分</li>
              <li>📱 スマホのままお進みください</li>
              <li>🔒 入力内容は安全に管理されます</li>
            </ul>
            <button onClick={next}
              className="w-full bg-ocean-600 text-white py-3 rounded-xl font-medium hover:bg-ocean-700 transition-colors">
              入力を始める →
            </button>
          </div>
        )}

        {step === 'basic' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">① 基本情報</h2>
            <div className="grid grid-cols-2 gap-3">
              <F label="姓 *"><input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="田中" required className={inp} /></F>
              <F label="名 *"><input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="花子" required className={inp} /></F>
              <F label="せい *"><input value={form.lastNameKana} onChange={(e) => set('lastNameKana', e.target.value)} placeholder="タナカ" className={inp} /></F>
              <F label="な *"><input value={form.firstNameKana} onChange={(e) => set('firstNameKana', e.target.value)} placeholder="ハナコ" className={inp} /></F>
            </div>
            <F label="生年月日 *"><input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} required className={inp} /></F>
            <F label="性別 *">
              <div className="flex gap-3">
                {(['male','female','other'] as const).map((g) => (
                  <label key={g} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" value={g} checked={form.gender === g} onChange={() => set('gender', g)} />
                    <span className="text-sm">{g === 'male' ? '男性' : g === 'female' ? '女性' : 'その他'}</span>
                  </label>
                ))}
              </div>
            </F>
            <F label="住所 *"><input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="東京都渋谷区" required className={inp} /></F>
            <F label="電話番号 *"><input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="090-0000-0000" required className={inp} /></F>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-medium text-gray-700 mb-2">緊急連絡先</p>
              <div className="space-y-3">
                <F label="氏名 *"><input value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} placeholder="田中 太郎" required className={inp} /></F>
                <div className="grid grid-cols-2 gap-3">
                  <F label="続柄"><input value={form.emergencyRelation} onChange={(e) => set('emergencyRelation', e.target.value)} placeholder="配偶者" className={inp} /></F>
                  <F label="電話番号 *"><input type="tel" value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} placeholder="090-0000-0001" required className={inp} /></F>
                </div>
              </div>
            </div>
            <Nav onPrev={prev} onNext={next} canNext={!!form.lastName && !!form.firstName && !!form.birthDate} />
          </div>
        )}

        {step === 'health' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">② 健康状態</h2>
            <p className="text-xs text-gray-500">該当するものにチェックしてください</p>
            {[
              ['heartDisease', '心臓・循環器系疾患（心臓病・不整脈・高血圧）'],
              ['respiratoryDisease', '呼吸器系疾患（喘息・肺疾患）'],
              ['earDisease', '耳・副鼻腔の疾患（中耳炎・副鼻腔炎）'],
              ['epilepsy', 'てんかん・失神の既往'],
              ['diabetes', '糖尿病'],
              ['pregnant', '妊娠中'],
              ['panicDisorder', 'パニック障害・閉所恐怖症'],
              ['latexAllergy', 'ラテックスアレルギー'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form[key as keyof typeof form] as boolean}
                  onChange={(e) => set(key as keyof typeof form, e.target.checked as never)}
                  className="w-4 h-4 accent-ocean-600" />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.medication} onChange={(e) => set('medication', e.target.checked)} className="w-4 h-4 accent-ocean-600" />
              <span className="text-sm text-gray-700">現在服薬中</span>
            </label>
            {form.medication && (
              <F label="薬剤名"><input value={form.medicationName} onChange={(e) => set('medicationName', e.target.value)} placeholder="薬の名前" className={inp} /></F>
            )}
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'today' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="font-bold text-gray-800">③ 当日体調・フライト予定</h2>
            <F label="昨夜の睡眠時間">
              <div className="flex items-center gap-3">
                <input type="range" min={1} max={12} value={form.sleepHours}
                  onChange={(e) => set('sleepHours', Number(e.target.value))} className="flex-1 accent-ocean-600" />
                <span className="text-sm font-semibold w-16">{form.sleepHours}時間</span>
              </div>
            </F>
            <div className="space-y-3">
              {[
                ['alcoholLastNight', '昨夜、飲酒した'] as const,
                ['alcoholToday', '今日すでに飲酒した'] as const,
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} className="w-4 h-4 accent-ocean-600" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
            <F label="今日の体調">
              <div className="flex gap-3">
                {(['good','normal','bad'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => set('condition', c)}
                    className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${form.condition === c ? 'bg-ocean-600 text-white border-ocean-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {c === 'good' ? '😊 良い' : c === 'normal' ? '😐 普通' : '😔 悪い'}
                  </button>
                ))}
              </div>
            </F>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.flightWithin48h} onChange={(e) => set('flightWithin48h', e.target.checked)} className="w-4 h-4 mt-0.5 accent-ocean-600" />
              <span className="text-sm text-gray-700">
                ダイビング終了後48時間以内に飛行機に乗る予定がある
                <span className="block text-xs text-red-600 mt-0.5">※ 減圧症リスクのためガイドに確認が必要です</span>
              </span>
            </label>
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'experience' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">④ 経験・スキル</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.hasCCard} onChange={(e) => set('hasCCard', e.target.checked)} className="w-4 h-4 accent-ocean-600" />
              <span className="text-sm text-gray-700">Cカード（ダイビングライセンス）を持っている</span>
            </label>
            {form.hasCCard && (
              <div className="space-y-3 pl-7">
                <div className="grid grid-cols-2 gap-3">
                  <F label="カード種別">
                    <select value={form.cCardType} onChange={(e) => set('cCardType', e.target.value)} className={inp}>
                      <option value="">選択</option>
                      {['OW','AOW','Rescue','Divemaster','Instructor'].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </F>
                  <F label="認定団体">
                    <select value={form.cCardOrg} onChange={(e) => set('cCardOrg', e.target.value)} className={inp}>
                      <option value="">選択</option>
                      {['PADI','NAUI','SSI','BSAC','その他'].map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </F>
                </div>
                <F label="最後にダイビングした時期"><input type="month" value={form.lastDiveDate} onChange={(e) => set('lastDiveDate', e.target.value)} className={inp} /></F>
                <F label="総ダイビング本数"><input type="number" min={0} value={form.totalDives || ''} onChange={(e) => set('totalDives', Number(e.target.value))} placeholder="0" className={inp} /></F>
              </div>
            )}
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'agree' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">⑤ 同意事項</h2>
            {[
              ['agreeRisk', 'ダイビングにはリスクが伴うことを理解し、自己責任で参加することに同意します。'],
              ['agreeMedical', '緊急時に必要な医療処置を受けることに同意します。'],
              ['agreePhoto', '当日の写真・動画をSNS等に使用することを許可します。（任意）'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={form[key as keyof typeof form] as boolean}
                  onChange={(e) => set(key as keyof typeof form, e.target.checked as never)}
                  className="w-4 h-4 mt-0.5 accent-ocean-600" />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
            <div className="flex gap-3 pt-4">
              <button onClick={prev} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl text-sm hover:bg-gray-50">← 戻る</button>
              <button onClick={handleSubmit} disabled={!form.agreeRisk || !form.agreeMedical || submitting}
                className="flex-1 bg-ocean-600 text-white py-3 rounded-xl font-medium text-sm hover:bg-ocean-700 disabled:opacity-40 transition-colors">
                {submitting ? '送信中…' : '提出する ✓'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 text-center">
            <div className="text-5xl">✅</div>
            <div>
              <h2 className="font-bold text-gray-800 text-lg mb-1">問診票を提出しました</h2>
              <p className="text-sm text-gray-500">受付でこの画面を見せてください</p>
            </div>
            <div className="flex justify-center">
              <QRCodeSVG value={qId} size={200} />
            </div>
            <p className="text-xs text-gray-400">QRコード ID: {qId}</p>
            <div className="bg-ocean-50 rounded-xl p-4 text-left">
              <p className="text-sm font-medium text-ocean-800 mb-1">提出者</p>
              <p className="text-lg font-bold text-gray-800">{form.lastName} {form.firstName}</p>
              <p className="text-sm text-gray-500">{form.lastNameKana} {form.firstNameKana}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500'
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>{children}</div>
}
function Nav({ onPrev, onNext, canNext }: { onPrev: () => void; onNext: () => void; canNext: boolean }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={onPrev} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl text-sm hover:bg-gray-50">← 戻る</button>
      <button onClick={onNext} disabled={!canNext}
        className="flex-1 bg-ocean-600 text-white py-3 rounded-xl font-medium text-sm hover:bg-ocean-700 disabled:opacity-40 transition-colors">
        次へ →
      </button>
    </div>
  )
}
