'use client'

import { useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { SLEEP_OPTIONS, CARD_OPTIONS, ORG_OPTIONS, DIVE_OPTIONS, TODAY_FIELDS, validateQuestionnaireExperience, type FieldErrors } from '@/lib/questionnaireValidation'
import type { QuestionnaireData } from '@/types'

type Step = 'intro' | 'basic' | 'health' | 'today' | 'experience' | 'agree' | 'done'
const STEPS: Step[] = ['intro', 'basic', 'health', 'today', 'experience', 'agree', 'done']
const STEP_LABELS = ['はじめに', '基本情報', '健康状態', '当日体調', '経験・スキル', '同意事項', '完了']

type QuestionnaireForm = Omit<QuestionnaireData, 'id' | 'reservationId' | 'submittedAt' | 'agreePhoto' | 'alcoholLastNight' | 'alcoholToday' | 'flightWithin48h' | 'condition' | 'totalDives'> & { agreePhoto: boolean | null; alcoholLastNight: boolean | null; alcoholToday: boolean | null; flightWithin48h: boolean | null; condition: '' | 'good' | 'normal' | 'bad'; totalDives: string }

const BLANK: QuestionnaireForm = {
  lastName: '', firstName: '', lastNameKana: '', firstNameKana: '',
  birthDate: '', gender: 'male', address: '', phone: '',
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  heartDisease: false, respiratoryDisease: false, earDisease: false,
  epilepsy: false, diabetes: false, pregnant: false, panicDisorder: false,
  medication: false, medicationName: '', latexAllergy: false,
  sleepHours: null, sleepCategory: '', conditionDetails: '', alcoholLastNight: null, alcoholToday: null, condition: '',
  flightWithin48h: null,
  hasCCard: false, cCardType: '', cCardOrg: '', lastDiveDate: '', lastDivePeriod: '', totalDives: '',
  agreeRisk: false, agreeMedical: false, agreePhoto: null,
}

export default function QuestionnairePage() {
  const { id } = useParams<{ id: string }>()
  const [step, setStep] = useState<Step>('intro')
  const [form, setForm] = useState(BLANK)
  const [errors, setErrors] = useState<FieldErrors>({})
  const payload = { ...form, totalDives: form.totalDives === '' ? null : (/^[0-9]+$/.test(form.totalDives) ? Number(form.totalDives) : NaN) }
  const [qId, setQId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [submitError, setSubmitError] = useState('')
  const submissionLock = useRef(false)

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function next() {
    if (step === 'today' || step === 'experience') {
      const all = validateQuestionnaireExperience(payload)
      const fields = Object.fromEntries(Object.entries(all).filter(([key]) => step === 'today' ? (TODAY_FIELDS as readonly string[]).includes(key) : !(TODAY_FIELDS as readonly string[]).includes(key)))
      setErrors(fields)
      if (Object.keys(fields).length) return
    }
    const idx = STEPS.indexOf(step)
    setStep(STEPS[idx + 1])
    window.scrollTo(0, 0)
  }
  function prev() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  async function handleSubmit() {
    if (submissionLock.current) return
    setSubmitError('')
    const fieldErrors = validateQuestionnaireExperience(payload)
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors)
      setStep(TODAY_FIELDS.some(key => fieldErrors[key]) ? 'today' : 'experience')
      window.scrollTo(0, 0)
      return
    }
    if (!form.agreeRisk || !form.agreeMedical || typeof form.agreePhoto !== 'boolean') {
      setSubmitError('必須の同意事項と写真・動画の使用可否を確認してください。')
      return
    }
    submissionLock.current = true
    setSubmitting(true)
    try {
      const res = await fetch('/api/public/questionnaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: id, ...payload }),
      })
      if (!res.ok) {
        if (res.status === 400) {
          const errorData = await res.json()
          if (errorData.fieldErrors && typeof errorData.fieldErrors === 'object') {
            setErrors(errorData.fieldErrors)
            setStep(TODAY_FIELDS.some(key => errorData.fieldErrors[key]) ? 'today' : 'experience')
            window.scrollTo(0, 0)
            return
          }
        }
        setSubmitError(res.status === 404
          ? '予約が見つかりません。予約URLを確認するか、スタッフにお問い合わせください。'
          : res.status === 400
            ? '入力内容に不備があります。同意事項と入力内容を確認してください。'
            : '送信結果を確認できませんでした。入力内容は保持されています。時間をおいて再度お試しください。')
        return
      }
      const data = await res.json()
      if (data?.ok !== true || typeof data.questionnaireId !== 'string' || !data.questionnaireId.trim()) {
        throw new Error('Invalid submission response')
      }
      setQId(data.questionnaireId)
      setStep('done')
      window.scrollTo(0, 0)
    } catch {
      setSubmitError('送信結果を確認できませんでした。入力内容は保持されています。通信環境を確認して再度お試しください。')
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
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
            <h2 className="font-bold text-gray-800">③ 当日体調</h2>
            <Choice name="sleepCategory" label="前夜の睡眠時間（必須）" value={form.sleepCategory ?? ''} options={SLEEP_OPTIONS} error={errors.sleepCategory} onChange={value => set('sleepCategory', value)} />
            {(['alcoholLastNight', 'alcoholToday'] as const).map(key => (
              <YesNo key={key} name={key} label={key === 'alcoholLastNight' ? '前夜の飲酒（必須）' : '当日の飲酒（必須）'} value={form[key]} error={errors[key]} onChange={value => set(key, value)} />
            ))}
            <Choice name="condition" label="当日の体調（必須）" value={form.condition} options={['good', 'normal', 'bad']} labels={['良い', '普通', '悪い']} error={errors.condition} onChange={value => set('condition', value as QuestionnaireForm['condition'])} />
            {form.condition === 'bad' && <div>
              <label htmlFor="conditionDetails" className="block text-sm mb-1">体調の詳細（必須）</label>
              <textarea id="conditionDetails" value={form.conditionDetails} maxLength={1000} aria-invalid={!!errors.conditionDetails} aria-describedby="conditionDetails-error" onChange={e => set('conditionDetails', e.target.value)} className={inp} />
              <FieldError name="conditionDetails" error={errors.conditionDetails} />
            </div>}
            <h2 className="font-bold text-gray-800 border-t pt-4">④ フライト予定</h2>
            <YesNo name="flightWithin48h" label="ダイビング終了後48時間以内の飛行機搭乗予定（必須）" value={form.flightWithin48h} error={errors.flightWithin48h} onChange={value => set('flightWithin48h', value)} />
            {form.flightWithin48h && <p role="status" className="text-sm text-red-700">減圧症リスク確認のため、ガイドに搭乗予定をお伝えください。</p>}
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'experience' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">⑤ 経験・スキル</h2>
            <Choice name="cCardType" label="Cカードの有無・種別（必須）" value={form.cCardType} options={CARD_OPTIONS} error={errors.cCardType} onChange={value => setForm(f => ({ ...f, cCardType: value, hasCCard: value !== '' && value !== '未取得', cCardOrg: value === '未取得' || value === '' ? '' : f.cCardOrg }))} />
            {form.hasCCard && <Choice name="cCardOrg" label="認定団体（任意）" value={form.cCardOrg} options={ORG_OPTIONS} error={errors.cCardOrg} onChange={value => set('cCardOrg', value)} />}
            <Choice name="lastDivePeriod" label="最後にダイビングした時期（必須）" value={form.lastDivePeriod ?? ''} options={DIVE_OPTIONS} error={errors.lastDivePeriod} onChange={value => set('lastDivePeriod', value)} />
            <div>
              <label htmlFor="totalDives" className="block text-sm mb-1">総ダイビング本数（任意）</label>
              <input id="totalDives" type="text" inputMode="numeric" value={form.totalDives} onChange={e => set('totalDives', e.target.value)} aria-invalid={!!errors.totalDives} aria-describedby="totalDives-error" placeholder="例：0" className={inp} />
              <FieldError name="totalDives" error={errors.totalDives} />
            </div>
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'agree' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">⑥ 同意事項</h2>
            <fieldset disabled={submitting} className="space-y-4" aria-busy={submitting}>
              <legend className="sr-only">参加に関する同意</legend>
              {([
                ['agreeRisk', 'ダイビングにはリスクが伴うことを理解し、自己責任で参加することに同意します。'],
                ['agreeMedical', '緊急時に必要な医療処置を受けることに同意します。'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer py-2">
                  <input type="checkbox" required checked={form[key]}
                    onChange={(e) => set(key, e.target.checked)}
                    className="w-5 h-5 mt-0.5 accent-ocean-600" />
                  <span className="text-sm text-gray-700">{label}<span className="text-red-600">（必須）</span></span>
                </label>
              ))}
              <fieldset>
                <legend className="text-sm text-gray-700">写真・動画のSNS等への使用<span className="text-red-600">（選択必須）</span></legend>
                <p className="text-xs text-gray-500 mt-1">使用を許可しない場合も提出できます。</p>
                <div className="flex gap-6 mt-2">
                  {([true, false] as const).map((value) => (
                    <label key={String(value)} className="flex items-center gap-2 py-2 cursor-pointer">
                      <input type="radio" name="agreePhoto" required checked={form.agreePhoto === value}
                        onChange={() => set('agreePhoto', value)} className="w-5 h-5 accent-ocean-600" />
                      <span className="text-sm">{value ? '可（許可する）' : '不可（許可しない）'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {(!form.agreeRisk || !form.agreeMedical || form.agreePhoto === null) && (
                <p className="text-sm text-gray-600">必須の2項目に同意し、写真・動画の使用可否を選択してください。</p>
              )}
              <div className="flex gap-3 pt-4">
                <button onClick={prev} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl text-sm hover:bg-gray-50">← 戻る</button>
                <button onClick={handleSubmit} disabled={!form.agreeRisk || !form.agreeMedical || form.agreePhoto === null || submitting}
                  className="flex-1 bg-ocean-600 text-white py-3 rounded-xl font-medium text-sm hover:bg-ocean-700 disabled:opacity-40 transition-colors">
                  {submitting ? '送信中…' : 'QRコードを発行する'}
                </button>
              </div>
            </fieldset>
            {submitError && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3">{submitError}</p>}
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

function FieldError({ name, error }: { name: string; error?: string }) {
  return <p id={name + '-error'} role={error ? 'alert' : undefined} className="text-sm text-red-700 mt-1">{error}</p>
}
function Choice({ name, label, value, options, labels, error, onChange }: { name: string; label: string; value: string; options: readonly string[]; labels?: readonly string[]; error?: string; onChange: (value: string) => void }) {
  return <div>
    <label htmlFor={name} className="block text-sm mb-1">{label}</label>
    <select id={name} value={value} onChange={e => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={name + '-error'} className={inp}>
      <option value="">選択してください</option>
      {options.map((option, i) => <option key={option} value={option}>{labels?.[i] ?? option}</option>)}
    </select>
    <FieldError name={name} error={error} />
  </div>
}
function YesNo({ name, label, value, error, onChange }: { name: string; label: string; value: boolean | null; error?: string; onChange: (value: boolean) => void }) {
  return <fieldset aria-describedby={name + '-error'} aria-invalid={!!error}>
    <legend className="text-sm">{label}</legend>
    <div className="flex gap-6">{[true, false].map(answer => <label key={String(answer)} className="flex items-center gap-2 py-3">
      <input type="radio" name={name} checked={value === answer} onChange={() => onChange(answer)} className="w-5 h-5 accent-ocean-600" />{answer ? 'あり' : 'なし'}
    </label>)}</div>
    <FieldError name={name} error={error} />
  </fieldset>
}
