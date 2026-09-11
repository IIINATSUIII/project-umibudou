'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import type { QuestionnaireData } from '@/types'

import { BASIC_FIELDS, HEALTH_FIELDS, calculateAge, todayInJapan, validateQuestionnaire, type FieldErrors } from '@/lib/questionnaireValidation'

type HealthKey = typeof HEALTH_FIELDS[number][0] | 'medication' | 'medicalCertificate'
type FormData = Omit<QuestionnaireData, 'id' | 'reservationId' | 'submittedAt' | HealthKey> & Record<HealthKey, boolean | null>

type Step = 'intro' | 'basic' | 'health' | 'today' | 'experience' | 'agree' | 'done'
const STEPS: Step[] = ['intro', 'basic', 'health', 'today', 'experience', 'agree', 'done']
const STEP_LABELS = ['はじめに', '基本情報', '健康状態', '当日体調', '経験・スキル', '同意事項', '完了']

const BLANK: FormData = {
  lastName: '', firstName: '', lastNameKana: '', firstNameKana: '',
  birthDate: '', gender: 'unanswered', postalCode: '', email: '', address: '', phone: '', hypertension: null, medicalCertificate: null,
  emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  heartDisease: null, respiratoryDisease: null, earDisease: null,
  epilepsy: null, diabetes: null, pregnant: null, panicDisorder: null,
  medication: null, medicationName: '', latexAllergy: null,
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

  const [errors, setErrors] = useState<FieldErrors>({})
  const [focusField, setFocusField] = useState('')
  const [submitError, setSubmitError] = useState('')
  useEffect(() => {
    if (!focusField) return
    const element = document.getElementById(focusField)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element?.focus({ preventScroll: true })
    setFocusField('')
  }, [focusField, step])

  function check(section: 'basic' | 'health' | 'all') {
    const found = validateQuestionnaire(form, section)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (!first) return true
    setStep(BASIC_FIELDS.some((key) => key === first) ? 'basic' : 'health')
    setFocusField(first)
    return false
  }

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function next() {
    if ((step === 'basic' || step === 'health') && !check(step)) return
    const idx = STEPS.indexOf(step)
    setStep(STEPS[idx + 1])
    window.scrollTo(0, 0)
  }
  function prev() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  async function handleSubmit() {
    if (submitting || !check('all')) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/public/questionnaires', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 400 && data.errors) {
          setErrors(data.errors)
          const first = Object.keys(data.errors)[0]
          if (first) {
            setStep(BASIC_FIELDS.some((key) => key === first) ? 'basic' : 'health')
            setFocusField(first)
          }
        }
        throw new Error(data.error || '送信に失敗しました。時間をおいて再度お試しください。')
      }
      setQId(data.questionnaireId)
      setStep('done')
      window.scrollTo(0, 0)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '通信に失敗しました。再度お試しください。')
    } finally {
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
        {submitError && <p role="alert" className="mb-4 text-red-700">{submitError}</p>}

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
            <p className="text-sm text-gray-600">* は必須項目です。</p>
            <F label="姓 *" id="lastName" error={errors.lastName}><input id="lastName" aria-invalid={!!errors.lastName} aria-describedby={errors.lastName ? 'lastName-error' : undefined} type="text" autoComplete="family-name" value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} className={inp} /></F>
            <F label="名 *" id="firstName" error={errors.firstName}><input id="firstName" aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? 'firstName-error' : undefined} type="text" autoComplete="given-name" value={form.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} className={inp} /></F>
            <F label="セイ（カナ） *" id="lastNameKana" error={errors.lastNameKana}><input id="lastNameKana" aria-invalid={!!errors.lastNameKana} aria-describedby={errors.lastNameKana ? 'lastNameKana-error' : undefined} type="text" value={form.lastNameKana ?? ''} onChange={(e) => set('lastNameKana', e.target.value)} className={inp} /></F>
            <F label="メイ（カナ） *" id="firstNameKana" error={errors.firstNameKana}><input id="firstNameKana" aria-invalid={!!errors.firstNameKana} aria-describedby={errors.firstNameKana ? 'firstNameKana-error' : undefined} type="text" value={form.firstNameKana ?? ''} onChange={(e) => set('firstNameKana', e.target.value)} className={inp} /></F>
            <F label="生年月日 *" id="birthDate" error={errors.birthDate}><input id="birthDate" aria-invalid={!!errors.birthDate} aria-describedby={errors.birthDate ? 'birthDate-error' : undefined} type="date" autoComplete="bday" max={todayInJapan()}  value={form.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value)} className={inp} /></F>
            <p className="text-sm" aria-live="polite">年齢：{calculateAge(form.birthDate) ?? "—"} 歳</p>
            <F label="郵便番号 *" id="postalCode" error={errors.postalCode}><input id="postalCode" aria-invalid={!!errors.postalCode} aria-describedby={errors.postalCode ? 'postalCode-error' : undefined} type="text" autoComplete="postal-code"  inputMode="numeric" value={form.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} className={inp} /></F>
            <F label="住所 *" id="address" error={errors.address}><input id="address" aria-invalid={!!errors.address} aria-describedby={errors.address ? 'address-error' : undefined} type="text" autoComplete="street-address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} className={inp} /></F>
            <F label="電話番号 *" id="phone" error={errors.phone}><input id="phone" aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'phone-error' : undefined} type="tel" autoComplete="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} className={inp} /></F>
            <F label="メールアドレス *" id="email" error={errors.email}><input id="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} type="email" autoComplete="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={inp} /></F>
            <F label="緊急連絡先の氏名 *" id="emergencyName" error={errors.emergencyName}><input id="emergencyName" aria-invalid={!!errors.emergencyName} aria-describedby={errors.emergencyName ? 'emergencyName-error' : undefined} type="text" value={form.emergencyName ?? ''} onChange={(e) => set('emergencyName', e.target.value)} className={inp} /></F>
            <F label="緊急連絡先の続柄 *" id="emergencyRelation" error={errors.emergencyRelation}><input id="emergencyRelation" aria-invalid={!!errors.emergencyRelation} aria-describedby={errors.emergencyRelation ? 'emergencyRelation-error' : undefined} type="text" value={form.emergencyRelation ?? ''} onChange={(e) => set('emergencyRelation', e.target.value)} className={inp} /></F>
            <F label="緊急連絡先の電話番号 *" id="emergencyPhone" error={errors.emergencyPhone}><input id="emergencyPhone" aria-invalid={!!errors.emergencyPhone} aria-describedby={errors.emergencyPhone ? 'emergencyPhone-error' : undefined} type="tel" value={form.emergencyPhone ?? ''} onChange={(e) => set('emergencyPhone', e.target.value)} className={inp} /></F>
            <F label="性別（任意）" id="gender" error={errors.gender}>
              <select id="gender" value={form.gender} onChange={(e) => set('gender', e.target.value as FormData['gender'])} className={inp}>
                <option value="unanswered">未回答</option><option value="male">男性</option><option value="female">女性</option><option value="other">その他</option>
              </select>
            </F>
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}
        {step === 'health' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">② 健康状態</h2>
            <p className="text-sm text-gray-600">各項目の「あり」「なし」を選択してください。すべて回答必須です。</p>
            {HEALTH_FIELDS.map(([key, label]) => <Answer key={key} id={key} label={label} value={form[key]} error={errors[key]} onChange={(value) => set(key, value)} />)}
            <Answer id="medication" label="現在の内服薬" value={form.medication} error={errors.medication} onChange={(value) => { set('medication', value); if (!value) set('medicationName', '') }} />
            {form.medication === true && <F label="薬剤名 *" id="medicationName" error={errors.medicationName}><input id="medicationName" aria-invalid={!!errors.medicationName} aria-describedby={errors.medicationName ? 'medicationName-error' : undefined} value={form.medicationName} onChange={(e) => set('medicationName', e.target.value)} className={inp} /></F>}
            <Answer id="medicalCertificate" label="医師の潜水許可書の持参（自己申告）" value={form.medicalCertificate} error={errors.medicalCertificate} onChange={(value) => set('medicalCertificate', value)} />
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

const inp = 'w-full border border-gray-300 rounded-lg min-h-12 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ocean-500'
function F({ label, children, id, error }: { label: string; children: React.ReactNode; id?: string; error?: string }) {
  return <div><label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>{children}{error && <p id={id + '-error'} role="alert" className="text-sm text-red-600 mt-1">{error}</p>}</div>
}
function Answer({ id, label, value, error, onChange }: { id: string; label: string; value: boolean | null; error?: string; onChange: (value: boolean) => void }) {
  return <fieldset id={id} tabIndex={-1} aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined} className="space-y-2">
    <legend className="text-sm font-medium text-gray-700">{label} *</legend>
    <div className="flex gap-3">{[true, false].map((answer) => <label key={String(answer)} className="flex flex-1 min-h-12 items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer">
      <input type="radio" name={id} checked={value === answer} onChange={() => onChange(answer)} className="w-5 h-5 accent-ocean-600" />{answer ? 'あり' : 'なし'}
    </label>)}</div>
    {error && <p id={id + '-error'} role="alert" className="text-sm text-red-600">{error}</p>}
  </fieldset>
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
