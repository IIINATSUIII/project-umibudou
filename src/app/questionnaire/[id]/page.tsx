'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import type { QuestionnaireFormData } from '@/types'

import {
  BASIC_FIELDS,
  HEALTH_FIELDS,
  calculateAge,
  todayInJapan,
  validateQuestionnaire,
  type FieldErrors,
} from '@/lib/questionnaireValidation'

import {
  SLEEP_OPTIONS,
  CARD_OPTIONS,
  ORG_OPTIONS,
  DIVE_OPTIONS,
  TODAY_FIELDS,
  validateQuestionnaireExperience,
} from '@/lib/questionnaireExperience'

type HealthKey =
  | (typeof HEALTH_FIELDS)[number][0]
  | 'medication'
  | 'medicalCertificate'
type FormData = Omit<
  QuestionnaireFormData,
  | HealthKey
  | 'agreePhoto'
  | 'alcoholLastNight'
  | 'alcoholToday'
  | 'flightWithin48h'
  | 'condition'
  | 'totalDives'
> &
  Record<HealthKey, boolean | null> & {
    agreePhoto: boolean | null
    alcoholLastNight: boolean | null
    alcoholToday: boolean | null
    flightWithin48h: boolean | null
    condition: '' | 'good' | 'normal' | 'bad'
    totalDives: string
  }
type QuestionnaireForm = FormData

type Step =
  | 'intro'
  | 'basic'
  | 'health'
  | 'today'
  | 'experience'
  | 'agree'
  | 'done'
const STEPS: Step[] = [
  'intro',
  'basic',
  'health',
  'today',
  'experience',
  'agree',
  'done',
]
const STEP_LABELS = [
  'はじめに',
  '基本情報',
  '健康状態',
  '当日体調',
  '経験・スキル',
  '同意事項',
  '完了',
]
type PendingSubmission = { id: string; createdAt: number }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readPendingSubmissions(key: string): PendingSubmission[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((item): item is PendingSubmission =>
      !!item && typeof item === 'object' &&
      typeof item.id === 'string' && UUID_PATTERN.test(item.id) &&
      typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) &&
      item.createdAt >= 0 && item.createdAt <= 8_640_000_000_000_000
    )
  } catch {
    return []
  }
}

function writePendingSubmissions(key: string, pending: PendingSubmission[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(pending))
  } catch {
    // Pending IDs are only a recovery aid; storage limits must not block form entry.
  }
}

const BLANK: FormData = {
  lastName: '',
  firstName: '',
  lastNameKana: '',
  firstNameKana: '',
  birthDate: '',
  gender: 'unanswered',
  postalCode: '',
  email: '',
  address: '',
  phone: '',
  hypertension: null,
  medicalCertificate: null,
  emergencyName: '',
  emergencyRelation: '',
  emergencyPhone: '',
  heartDisease: null,
  respiratoryDisease: null,
  earDisease: null,
  epilepsy: null,
  diabetes: null,
  pregnant: null,
  panicDisorder: null,
  medication: null,
  medicationName: '',
  latexAllergy: null,
  sleepHours: null,
  sleepCategory: '',
  conditionDetails: '',
  alcoholLastNight: null,
  alcoholToday: null,
  condition: '',
  flightWithin48h: null,
  hasCCard: false,
  cCardType: '',
  cCardOrg: '',
  lastDiveDate: '',
  lastDivePeriod: '',
  totalDives: '',
  agreeRisk: false,
  agreeMedical: false,
  agreePhoto: null,
}

export default function QuestionnairePage() {
  const { id } = useParams<{ id: string }>()
  const [step, setStep] = useState<Step>('intro')
  const [form, setForm] = useState(BLANK)
  const [qId, setQId] = useState('')
  const [qrToken, setQrToken] = useState('')
  const [qrExpiresAt, setQrExpiresAt] = useState('')
  const submissionLock = useRef(false)
  const initializedFor = useRef('')
  const submissionStorageKey = `questionnaire-submission:${id}`
  const pendingStorageKey = `questionnaire-pending-submissions:${id}`
  const [submissionId, setSubmissionId] = useState('')
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingSubmission[]>([])
  const payload = {
    ...form,
    totalDives:
      form.totalDives === ''
        ? null
        : /^[0-9]+$/.test(form.totalDives)
          ? Number(form.totalDives)
          : NaN,
  }
  const [submitting, setSubmitting] = useState(false)

  const [errors, setErrors] = useState<FieldErrors>({})
  const [focusField, setFocusField] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [checkingAccess, setCheckingAccess] = useState(true)
  const [accessError, setAccessError] = useState('')
  useEffect(() => {
    if (initializedFor.current !== submissionStorageKey) {
      initializedFor.current = submissionStorageKey
      let savedId = ''
      try {
        savedId = window.sessionStorage.getItem(submissionStorageKey) ?? ''
      } catch {
        // Continue with an in-memory ID when browser storage is unavailable.
      }
      const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const nextId = navigation?.type === 'reload' && UUID_PATTERN.test(savedId)
        ? savedId
        : window.crypto.randomUUID()
      try {
        window.sessionStorage.setItem(submissionStorageKey, nextId)
      } catch {
        // The ID remains available in component state for this visit.
      }
      setSubmissionId(nextId)

      let pending = readPendingSubmissions(pendingStorageKey)
      try {
        const legacyId = window.localStorage.getItem(submissionStorageKey) ?? ''
        if (UUID_PATTERN.test(legacyId) && !pending.some((item) => item.id === legacyId)) {
          pending = [...pending, { id: legacyId, createdAt: Date.now() }]
          writePendingSubmissions(pendingStorageKey, pending)
        }
        window.localStorage.removeItem(submissionStorageKey)
      } catch {
        // Pending recovery is best effort and contains no questionnaire answers.
      }
      setPendingSubmissions(pending)
    }

    const syncPending = (event: StorageEvent) => {
      if (event.key === pendingStorageKey) setPendingSubmissions(readPendingSubmissions(pendingStorageKey))
    }
    window.addEventListener('storage', syncPending)
    return () => window.removeEventListener('storage', syncPending)
  }, [pendingStorageKey, submissionStorageKey])

  useEffect(() => {
    if (!focusField) return
    const element = document.getElementById(focusField)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element?.focus({ preventScroll: true })
    setFocusField('')
  }, [focusField, step])

  function check(section: 'basic' | 'health' | 'today' | 'experience' | 'all') {
    const basic =
      section === 'basic' || section === 'health' || section === 'all'
        ? validateQuestionnaire(form, section === 'all' ? 'all' : section)
        : {}
    const experienceErrors =
      section === 'today' || section === 'experience' || section === 'all'
        ? validateQuestionnaireExperience(payload)
        : {}
    const selected = Object.fromEntries(
      Object.entries(experienceErrors).filter(
        ([key]) =>
          section === 'all' ||
          (section === 'today'
            ? (TODAY_FIELDS as readonly string[]).includes(key)
            : !(TODAY_FIELDS as readonly string[]).includes(key))
      )
    )
    const found = { ...basic, ...selected }
    setErrors(found)
    const first = Object.keys(found)[0]
    if (!first) return true
    setStep(
      (BASIC_FIELDS as readonly string[]).includes(first)
        ? 'basic'
        : Object.keys(basic).includes(first)
          ? 'health'
          : (TODAY_FIELDS as readonly string[]).includes(first)
            ? 'today'
            : 'experience'
    )
    setFocusField(first)
    return false
  }
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    if (submitError) {
      const nextId = window.crypto.randomUUID()
      try {
        window.sessionStorage.setItem(submissionStorageKey, nextId)
      } catch {
        // The new ID remains available in component state for this visit.
      }
      setSubmissionId(nextId)
      setSubmitError('')
    }
    setForm((f) => ({ ...f, [key]: value }))
  }

  useEffect(() => {
    let active = true
    setCheckingAccess(true)
    setAccessError('')
    fetch('/api/public/questionnaires?accessToken=' + encodeURIComponent(id))
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 410
          ? '受付QRが使用済みまたは期限切れです。スタッフにお問い合わせください。'
          : r.status === 404 ? '問診URLが無効または期限切れです。スタッフにお問い合わせください。'
            : '送信状態を確認できませんでした。再読み込みしてください。')
        const data = await r.json()
        if (typeof data.submitted !== 'boolean' || (data.submitted &&
          (data.ok !== true || typeof data.questionnaireId !== 'string' || !data.questionnaireId ||
           typeof data.qrToken !== 'string' || !data.qrToken ||
           !Number.isFinite(Date.parse(data.qrExpiresAt)) || Date.parse(data.qrExpiresAt) <= Date.now())))
          throw new Error('送信状態を確認できませんでした。再読み込みしてください。')
        if (active && data.submitted && data.ok && data.qrToken) {
          setForm((prev) => ({
            ...prev,
            lastName: data.lastName || '',
            firstName: data.firstName || '',
          }))
          setQId(data.questionnaireId)
          setQrToken(data.qrToken)
          setQrExpiresAt(data.qrExpiresAt)
          setStep('done')
        }
      })
      .catch((error) => { if (active) setAccessError(error instanceof Error ? error.message : '通信に失敗しました。再読み込みしてください。') })
      .finally(() => { if (active) setCheckingAccess(false) })
    return () => {
      active = false
    }
  }, [id])
  function next() {
    if (
      (step === 'basic' ||
        step === 'health' ||
        step === 'today' ||
        step === 'experience') &&
      !check(step)
    )
      return
    const idx = STEPS.indexOf(step)
    setStep(STEPS[idx + 1])
    window.scrollTo(0, 0)
  }
  function prev() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
  }

  function resumePendingSubmission(pendingId: string) {
    setSubmissionId(pendingId)
    setSubmitError('')
    try {
      window.sessionStorage.setItem(submissionStorageKey, pendingId)
    } catch {
      // The ID remains available in component state for this visit.
    }
    setForm(BLANK)
    setErrors({})
    setStep('basic')
    window.scrollTo(0, 0)
  }

  function startNextParticipant() {
    const nextId = window.crypto.randomUUID()
    try {
      window.sessionStorage.setItem(submissionStorageKey, nextId)
    } catch {
      // The new ID remains available in component state for this visit.
    }
    setSubmissionId(nextId)
    setForm(BLANK)
    setErrors({})
    setQId('')
    setQrToken('')
    setQrExpiresAt('')
    setSubmitError('')
    setStep('intro')
    window.scrollTo(0, 0)
  }

  async function handleSubmit() {
    if (submissionLock.current || !check('all')) return
    if (
      !form.agreeRisk ||
      !form.agreeMedical ||
      typeof form.agreePhoto !== 'boolean'
    ) {
      setSubmitError('必要な同意と写真利用の可否を確認してください')
      return
    }
    submissionLock.current = true
    setSubmitting(true)
    setSubmitError('')
    const activeSubmissionId = submissionId || window.crypto.randomUUID()
    setSubmissionId(activeSubmissionId)
    try {
      window.sessionStorage.setItem(submissionStorageKey, activeSubmissionId)
    } catch {
      // Request remains valid; recovery after closing the tab may be unavailable.
    }
    const pending = readPendingSubmissions(pendingStorageKey)
    const nextPending = pending.some((item) => item.id === activeSubmissionId)
      ? pending
      : [...pending, { id: activeSubmissionId, createdAt: Date.now() }]
    writePendingSubmissions(pendingStorageKey, nextPending)
    setPendingSubmissions(nextPending)
    try {
      const res = await fetch('/api/public/questionnaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: id, submissionId: activeSubmissionId, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 400 && data.errors) {
          setErrors(data.errors)
          const first = Object.keys(data.errors)[0]
          if (first) {
            setStep(
              BASIC_FIELDS.some((key) => key === first)
                ? 'basic'
                : [
                      ...HEALTH_FIELDS.map(([key]) => key),
                      'medication',
                      'medicationName',
                      'medicalCertificate',
                    ].includes(first)
                  ? 'health'
                  : (TODAY_FIELDS as readonly string[]).includes(first)
                    ? 'today'
                    : 'experience'
            )
            setFocusField(first)
          }
        }
        throw new Error(
          data.error || '送信に失敗しました。時間をおいて再度お試しください。'
        )
      }
      if (
        data.ok !== true ||
        typeof data.questionnaireId !== 'string' ||
        !data.questionnaireId ||
        typeof data.qrToken !== 'string' ||
        !data.qrToken ||
        !Number.isFinite(Date.parse(data.qrExpiresAt)) || Date.parse(data.qrExpiresAt) <= Date.now()
      )
        throw new Error('送信結果を確認できませんでした')
      const remainingPending = readPendingSubmissions(pendingStorageKey)
        .filter((item) => item.id !== activeSubmissionId)
      writePendingSubmissions(pendingStorageKey, remainingPending)
      setPendingSubmissions(remainingPending)
      try {
        if (window.sessionStorage.getItem(submissionStorageKey) === activeSubmissionId) {
          window.sessionStorage.removeItem(submissionStorageKey)
        }
      } catch {
        // Saved questionnaire cleanup is best effort.
      }
      setQrToken(data.qrToken)
      setQrExpiresAt(data.qrExpiresAt)
      setQId(data.questionnaireId)
      setStep('done')
      window.scrollTo(0, 0)
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : '通信に失敗しました。再度お試しください。'
      )
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  const stepIdx = STEPS.indexOf(step)
  const progress = Math.round((stepIdx / (STEPS.length - 1)) * 100)

  if (checkingAccess || accessError) return (
    <main className="max-w-lg mx-auto p-6 space-y-4">
      <h1 className="font-bold">ダイビング問診票</h1>
      {checkingAccess ? <p role="status">送信状態を確認しています…</p> : <>
        <p role="alert">{accessError}</p>
        <button onClick={() => window.location.reload()} className="bg-ocean-600 text-white rounded-lg px-4 py-3">再読み込み</button>
      </>}
    </main>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-ocean-700 text-white px-4 py-4">
        <div className="max-w-lg mx-auto">
          <h1 className="text-base font-bold">🤿 ダイビング問診票</h1>
          {step !== 'done' && step !== 'intro' && (
            <>
              <div className="mt-2 bg-white/20 rounded-full h-1.5">
                <div
                  className="bg-white rounded-full h-1.5 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs mt-1 text-white/70">
                {STEP_LABELS[stepIdx]}（{stepIdx} / {STEPS.length - 2}）
              </p>
            </>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {submitError && (
          <p role="alert" className="mb-4 text-red-700">
            {submitError}
          </p>
        )}

        {step === 'intro' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800 text-lg">
              問診票の入力をお願いします
            </h2>
            <p className="text-sm text-gray-600">
              安全なダイビングのため、健康状態と経験についてお教えください。
            </p>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>⏱ 所要時間：約5分</li>
              <li>📱 スマホのままお進みください</li>
              <li>🔒 入力内容は安全に管理されます</li>
            </ul>
            {pendingSubmissions.length > 0 && (
              <div className="border-t border-gray-100 pt-4 space-y-2">
                <p className="text-sm font-medium text-gray-700">未完了の送信があります</p>
                <p className="text-xs text-gray-500">再開すると同じ送信IDを使います。入力内容は端末に保存されていないため、同じ回答を再入力してください。</p>
                {pendingSubmissions.map((pending) => (
                  <button key={pending.id} type="button" onClick={() => resumePendingSubmission(pending.id)}
                    className="w-full border border-amber-300 text-amber-800 py-2 rounded-lg text-sm hover:bg-amber-50">
                    未完了の送信を再開（{new Date(pending.createdAt).toLocaleString('ja-JP')}）
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={next}
              className="w-full bg-ocean-600 text-white py-3 rounded-xl font-medium hover:bg-ocean-700 transition-colors"
            >
              入力を始める →
            </button>
          </div>
        )}

        {step === 'basic' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">① 基本情報</h2>
            <p className="text-sm text-gray-600">* は必須項目です。</p>
            <F label="姓 *" id="lastName" error={errors.lastName}>
              <input
                id="lastName"
                aria-invalid={!!errors.lastName}
                aria-describedby={
                  errors.lastName ? 'lastName-error' : undefined
                }
                type="text"
                autoComplete="family-name"
                value={form.lastName ?? ''}
                onChange={(e) => set('lastName', e.target.value)}
                className={inp}
              />
            </F>
            <F label="名 *" id="firstName" error={errors.firstName}>
              <input
                id="firstName"
                aria-invalid={!!errors.firstName}
                aria-describedby={
                  errors.firstName ? 'firstName-error' : undefined
                }
                type="text"
                autoComplete="given-name"
                value={form.firstName ?? ''}
                onChange={(e) => set('firstName', e.target.value)}
                className={inp}
              />
            </F>
            <F
              label="セイ（カナ） *"
              id="lastNameKana"
              error={errors.lastNameKana}
            >
              <input
                id="lastNameKana"
                aria-invalid={!!errors.lastNameKana}
                aria-describedby={
                  errors.lastNameKana ? 'lastNameKana-error' : undefined
                }
                type="text"
                value={form.lastNameKana ?? ''}
                onChange={(e) => set('lastNameKana', e.target.value)}
                className={inp}
              />
            </F>
            <F
              label="メイ（カナ） *"
              id="firstNameKana"
              error={errors.firstNameKana}
            >
              <input
                id="firstNameKana"
                aria-invalid={!!errors.firstNameKana}
                aria-describedby={
                  errors.firstNameKana ? 'firstNameKana-error' : undefined
                }
                type="text"
                value={form.firstNameKana ?? ''}
                onChange={(e) => set('firstNameKana', e.target.value)}
                className={inp}
              />
            </F>
            <F label="生年月日 *" id="birthDate" error={errors.birthDate}>
              <input
                id="birthDate"
                aria-invalid={!!errors.birthDate}
                aria-describedby={
                  errors.birthDate ? 'birthDate-error' : undefined
                }
                type="date"
                autoComplete="bday"
                max={todayInJapan()}
                value={form.birthDate ?? ''}
                onChange={(e) => set('birthDate', e.target.value)}
                className={inp}
              />
            </F>
            <p className="text-sm" aria-live="polite">
              年齢：{calculateAge(form.birthDate) ?? '—'} 歳
            </p>
            <F label="郵便番号 *" id="postalCode" error={errors.postalCode}>
              <input
                id="postalCode"
                aria-invalid={!!errors.postalCode}
                aria-describedby={
                  errors.postalCode ? 'postalCode-error' : undefined
                }
                type="text"
                autoComplete="postal-code"
                inputMode="numeric"
                value={form.postalCode ?? ''}
                onChange={(e) => set('postalCode', e.target.value)}
                className={inp}
              />
            </F>
            <F label="住所 *" id="address" error={errors.address}>
              <input
                id="address"
                aria-invalid={!!errors.address}
                aria-describedby={errors.address ? 'address-error' : undefined}
                type="text"
                autoComplete="street-address"
                value={form.address ?? ''}
                onChange={(e) => set('address', e.target.value)}
                className={inp}
              />
            </F>
            <F label="電話番号 *" id="phone" error={errors.phone}>
              <input
                id="phone"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                type="tel"
                autoComplete="tel"
                value={form.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
                className={inp}
              />
            </F>
            <F label="メールアドレス *" id="email" error={errors.email}>
              <input
                id="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                type="email"
                autoComplete="email"
                value={form.email ?? ''}
                onChange={(e) => set('email', e.target.value)}
                className={inp}
              />
            </F>
            <F
              label="緊急連絡先の氏名 *"
              id="emergencyName"
              error={errors.emergencyName}
            >
              <input
                id="emergencyName"
                aria-invalid={!!errors.emergencyName}
                aria-describedby={
                  errors.emergencyName ? 'emergencyName-error' : undefined
                }
                type="text"
                value={form.emergencyName ?? ''}
                onChange={(e) => set('emergencyName', e.target.value)}
                className={inp}
              />
            </F>
            <F
              label="緊急連絡先の続柄 *"
              id="emergencyRelation"
              error={errors.emergencyRelation}
            >
              <input
                id="emergencyRelation"
                aria-invalid={!!errors.emergencyRelation}
                aria-describedby={
                  errors.emergencyRelation
                    ? 'emergencyRelation-error'
                    : undefined
                }
                type="text"
                value={form.emergencyRelation ?? ''}
                onChange={(e) => set('emergencyRelation', e.target.value)}
                className={inp}
              />
            </F>
            <F
              label="緊急連絡先の電話番号 *"
              id="emergencyPhone"
              error={errors.emergencyPhone}
            >
              <input
                id="emergencyPhone"
                aria-invalid={!!errors.emergencyPhone}
                aria-describedby={
                  errors.emergencyPhone ? 'emergencyPhone-error' : undefined
                }
                type="tel"
                value={form.emergencyPhone ?? ''}
                onChange={(e) => set('emergencyPhone', e.target.value)}
                className={inp}
              />
            </F>
            <F label="性別（任意）" id="gender" error={errors.gender}>
              <select
                id="gender"
                value={form.gender}
                onChange={(e) =>
                  set('gender', e.target.value as FormData['gender'])
                }
                className={inp}
              >
                <option value="unanswered">未回答</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </select>
            </F>
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}
        {step === 'health' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">② 健康状態</h2>
            <p className="text-sm text-gray-600">
              各項目の「あり」「なし」を選択してください。すべて回答必須です。
            </p>
            {HEALTH_FIELDS.map(([key, label]) => (
              <Answer
                key={key}
                id={key}
                label={label}
                value={form[key]}
                error={errors[key]}
                onChange={(value) => set(key, value)}
              />
            ))}
            <Answer
              id="medication"
              label="現在の内服薬"
              value={form.medication}
              error={errors.medication}
              onChange={(value) => {
                set('medication', value)
                if (!value) set('medicationName', '')
              }}
            />
            {form.medication === true && (
              <F
                label="薬剤名 *"
                id="medicationName"
                error={errors.medicationName}
              >
                <input
                  id="medicationName"
                  aria-invalid={!!errors.medicationName}
                  aria-describedby={
                    errors.medicationName ? 'medicationName-error' : undefined
                  }
                  value={form.medicationName}
                  onChange={(e) => set('medicationName', e.target.value)}
                  className={inp}
                />
              </F>
            )}
            <Answer
              id="medicalCertificate"
              label="医師の潜水許可書の持参（自己申告）"
              value={form.medicalCertificate}
              error={errors.medicalCertificate}
              onChange={(value) => set('medicalCertificate', value)}
            />
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}
        {step === 'today' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="font-bold text-gray-800">③ 当日体調</h2>
            <Choice
              name="sleepCategory"
              label="前夜の睡眠時間（必須）"
              value={form.sleepCategory ?? ''}
              options={SLEEP_OPTIONS}
              error={errors.sleepCategory}
              onChange={(value) => set('sleepCategory', value)}
            />
            {(['alcoholLastNight', 'alcoholToday'] as const).map((key) => (
              <YesNo
                key={key}
                name={key}
                label={
                  key === 'alcoholLastNight'
                    ? '前夜の飲酒（必須）'
                    : '当日の飲酒（必須）'
                }
                value={form[key]}
                error={errors[key]}
                onChange={(value) => set(key, value)}
              />
            ))}
            <Choice
              name="condition"
              label="当日の体調（必須）"
              value={form.condition}
              options={['good', 'normal', 'bad']}
              labels={['良い', '普通', '悪い']}
              error={errors.condition}
              onChange={(value) =>
                set('condition', value as QuestionnaireForm['condition'])
              }
            />
            {form.condition === 'bad' && (
              <div>
                <label
                  htmlFor="conditionDetails"
                  className="block text-sm mb-1"
                >
                  体調の詳細（必須）
                </label>
                <textarea
                  id="conditionDetails"
                  value={form.conditionDetails}
                  maxLength={1000}
                  aria-invalid={!!errors.conditionDetails}
                  aria-describedby="conditionDetails-error"
                  onChange={(e) => set('conditionDetails', e.target.value)}
                  className={inp}
                />
                <FieldError
                  name="conditionDetails"
                  error={errors.conditionDetails}
                />
              </div>
            )}
            <h2 className="font-bold text-gray-800 border-t pt-4">
              ④ フライト予定
            </h2>
            <YesNo
              name="flightWithin48h"
              label="ダイビング終了後48時間以内の飛行機搭乗予定（必須）"
              value={form.flightWithin48h}
              error={errors.flightWithin48h}
              onChange={(value) => set('flightWithin48h', value)}
            />
            {form.flightWithin48h && (
              <p role="status" className="text-sm text-red-700">
                減圧症リスク確認のため、ガイドに搭乗予定をお伝えください。
              </p>
            )}
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'experience' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">⑤ 経験・スキル</h2>
            <Choice
              name="cCardType"
              label="Cカードの有無・種別（必須）"
              value={form.cCardType}
              options={CARD_OPTIONS}
              error={errors.cCardType}
              onChange={(value) =>
                setForm((f) => ({
                  ...f,
                  cCardType: value,
                  hasCCard: value !== '' && value !== '未取得',
                  cCardOrg:
                    value === '未取得' || value === '' ? '' : f.cCardOrg,
                }))
              }
            />
            {form.hasCCard && (
              <Choice
                name="cCardOrg"
                label="認定団体（任意）"
                value={form.cCardOrg}
                options={ORG_OPTIONS}
                error={errors.cCardOrg}
                onChange={(value) => set('cCardOrg', value)}
              />
            )}
            <Choice
              name="lastDivePeriod"
              label="最後にダイビングした時期（必須）"
              value={form.lastDivePeriod ?? ''}
              options={DIVE_OPTIONS}
              error={errors.lastDivePeriod}
              onChange={(value) => set('lastDivePeriod', value)}
            />
            <div>
              <label htmlFor="totalDives" className="block text-sm mb-1">
                総ダイビング本数（任意）
              </label>
              <input
                id="totalDives"
                type="text"
                inputMode="numeric"
                value={form.totalDives}
                onChange={(e) => set('totalDives', e.target.value)}
                aria-invalid={!!errors.totalDives}
                aria-describedby="totalDives-error"
                placeholder="例：0"
                className={inp}
              />
              <FieldError name="totalDives" error={errors.totalDives} />
            </div>
            <Nav onPrev={prev} onNext={next} canNext />
          </div>
        )}

        {step === 'agree' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-bold text-gray-800">⑥ 同意事項</h2>
            <fieldset
              disabled={submitting}
              className="space-y-4"
              aria-busy={submitting}
            >
              <legend className="sr-only">参加に関する同意</legend>
              {(
                [
                  [
                    'agreeRisk',
                    'ダイビングにはリスクが伴うことを理解し、自己責任で参加することに同意します。',
                  ],
                  [
                    'agreeMedical',
                    '緊急時に必要な医療処置を受けることに同意します。',
                  ],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-start gap-3 cursor-pointer py-2"
                >
                  <input
                    type="checkbox"
                    required
                    checked={form[key]}
                    onChange={(e) => set(key, e.target.checked)}
                    className="w-5 h-5 mt-0.5 accent-ocean-600"
                  />
                  <span className="text-sm text-gray-700">
                    {label}
                    <span className="text-red-600">（必須）</span>
                  </span>
                </label>
              ))}
              <fieldset>
                <legend className="text-sm text-gray-700">
                  写真・動画のSNS等への使用
                  <span className="text-red-600">（選択必須）</span>
                </legend>
                <p className="text-xs text-gray-500 mt-1">
                  使用を許可しない場合も提出できます。
                </p>
                <div className="flex gap-6 mt-2">
                  {([true, false] as const).map((value) => (
                    <label
                      key={String(value)}
                      className="flex items-center gap-2 py-2 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="agreePhoto"
                        required
                        checked={form.agreePhoto === value}
                        onChange={() => set('agreePhoto', value)}
                        className="w-5 h-5 accent-ocean-600"
                      />
                      <span className="text-sm">
                        {value ? '可（許可する）' : '不可（許可しない）'}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {(!form.agreeRisk ||
                !form.agreeMedical ||
                form.agreePhoto === null) && (
                <p className="text-sm text-gray-600">
                  必須の2項目に同意し、写真・動画の使用可否を選択してください。
                </p>
              )}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={prev}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl text-sm hover:bg-gray-50"
                >
                  ← 戻る
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    !form.agreeRisk ||
                    !form.agreeMedical ||
                    form.agreePhoto === null ||
                    submitting
                  }
                  className="flex-1 bg-ocean-600 text-white py-3 rounded-xl font-medium text-sm hover:bg-ocean-700 disabled:opacity-40 transition-colors"
                >
                  {submitting ? '送信中…' : 'QRコードを発行する'}
                </button>
              </div>
            </fieldset>
            {submitError && (
              <p
                role="alert"
                className="text-sm text-red-700 bg-red-50 rounded-lg p-3"
              >
                {submitError}
              </p>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 text-center">
            <div className="text-5xl">✅</div>
            <div>
              <h2 className="font-bold text-gray-800 text-lg mb-1">
                問診票を提出しました
              </h2>
              <p className="text-sm text-gray-500">
                受付でこの画面を見せてください
              </p>
            </div>
            <div className="flex justify-center">
              <QRCodeSVG value={qrToken} size={200} />
            </div>
            <p className="text-xs text-gray-400">問診票 ID: {qId}</p>
            <p className="text-xs text-gray-500">
              有効期限：
              {new Date(qrExpiresAt).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
              })}
            </p>
            <div className="bg-ocean-50 rounded-xl p-4 text-left">
              <p className="text-sm font-medium text-ocean-800 mb-1">提出者</p>
              <p className="text-lg font-bold text-gray-800">
                {form.lastName} {form.firstName}
              </p>
              <p className="text-sm text-gray-500">
                {form.lastNameKana} {form.firstNameKana}
              </p>
            </div>
            {pendingSubmissions.length > 0 && (
              <div className="border-t border-gray-100 pt-4 space-y-2">
                <p className="text-sm font-medium text-gray-700">未完了の送信があります</p>
                <p className="text-xs text-gray-500">同じ回答を再入力して再送すると、同じ問診票として処理されます。</p>
                {pendingSubmissions.map((pending) => (
                  <button key={pending.id} type="button" onClick={() => resumePendingSubmission(pending.id)}
                    className="w-full border border-amber-300 text-amber-800 py-2 rounded-lg text-sm hover:bg-amber-50">
                    未完了の送信を再開（{new Date(pending.createdAt).toLocaleString('ja-JP')}）
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={startNextParticipant}
              className="w-full border border-ocean-300 text-ocean-700 py-3 rounded-xl font-medium hover:bg-ocean-50">
              次の参加者の問診票を入力する
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const inp =
  'w-full border border-gray-300 rounded-lg min-h-12 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ocean-500'
function F({
  label,
  children,
  id,
  error,
}: {
  label: string
  children: React.ReactNode
  id?: string
  error?: string
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-gray-700 mb-1"
      >
        {label}
      </label>
      {children}
      {error && (
        <p
          id={id + '-error'}
          role="alert"
          className="text-sm text-red-600 mt-1"
        >
          {error}
        </p>
      )}
    </div>
  )
}
function Answer({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  value: boolean | null
  error?: string
  onChange: (value: boolean) => void
}) {
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-invalid={!!error}
      aria-describedby={error ? id + '-error' : undefined}
      className="space-y-2"
    >
      <legend className="text-sm font-medium text-gray-700">{label} *</legend>
      <div className="flex gap-3">
        {[true, false].map((answer) => (
          <label
            key={String(answer)}
            className="flex flex-1 min-h-12 items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer"
          >
            <input
              type="radio"
              name={id}
              checked={value === answer}
              onChange={() => onChange(answer)}
              className="w-5 h-5 accent-ocean-600"
            />
            {answer ? 'あり' : 'なし'}
          </label>
        ))}
      </div>
      {error && (
        <p id={id + '-error'} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  )
}
function Nav({
  onPrev,
  onNext,
  canNext,
}: {
  onPrev: () => void
  onNext: () => void
  canNext: boolean
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        onClick={onPrev}
        className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl text-sm hover:bg-gray-50"
      >
        ← 戻る
      </button>
      <button
        onClick={onNext}
        disabled={!canNext}
        className="flex-1 bg-ocean-600 text-white py-3 rounded-xl font-medium text-sm hover:bg-ocean-700 disabled:opacity-40 transition-colors"
      >
        次へ →
      </button>
    </div>
  )
}
function FieldError({ name, error }: { name: string; error?: string }) {
  return (
    <p
      id={name + '-error'}
      role={error ? 'alert' : undefined}
      className="text-sm text-red-700 mt-1"
    >
      {error}
    </p>
  )
}
function Choice({
  name,
  label,
  value,
  options,
  labels,
  error,
  onChange,
}: {
  name: string
  label: string
  value: string
  options: readonly string[]
  labels?: readonly string[]
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm mb-1">
        {label}
      </label>
      <select
        id={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={name + '-error'}
        className={inp}
      >
        <option value="">選択してください</option>
        {options.map((option, i) => (
          <option key={option} value={option}>
            {labels?.[i] ?? option}
          </option>
        ))}
      </select>
      <FieldError name={name} error={error} />
    </div>
  )
}
function YesNo({
  name,
  label,
  value,
  error,
  onChange,
}: {
  name: string
  label: string
  value: boolean | null
  error?: string
  onChange: (value: boolean) => void
}) {
  return (
    <fieldset aria-describedby={name + '-error'} aria-invalid={!!error}>
      <legend className="text-sm">{label}</legend>
      <div className="flex gap-6">
        {[true, false].map((answer) => (
          <label key={String(answer)} className="flex items-center gap-2 py-3">
            <input
              type="radio"
              name={name}
              checked={value === answer}
              onChange={() => onChange(answer)}
              className="w-5 h-5 accent-ocean-600"
            />
            {answer ? 'あり' : 'なし'}
          </label>
        ))}
      </div>
      <FieldError name={name} error={error} />
    </fieldset>
  )
}
