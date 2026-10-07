'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import StaffQuestionnaireCheck from '@/components/StaffQuestionnaireCheck'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { addRoster, fetchCustomers, fetchQuestionnaireById, fetchQuestionnaires, fetchReservations } from '@/lib/api'
import type { Customer, QuestionnaireData, Reservation } from '@/types'
import { matchesQuestionnaire } from '@/lib/questionnaireUtils'

const HEALTH_FLAGS: [keyof QuestionnaireData, string][] = [
  ['heartDisease', '心臓・循環器系疾患'],
  ['respiratoryDisease', '呼吸器系疾患'],
  ['earDisease', '耳・副鼻腔の疾患'],
  ['epilepsy', 'てんかん・失神'],
  ['diabetes', '糖尿病'],
  ['pregnant', '妊娠中'],
  ['hypertension', '高血圧'],
  ['highBloodPressure', '高血圧'],
  ['panicDisorder', 'パニック障害・閉所恐怖症'],
  ['medication', '服薬中'],
  ['latexAllergy', 'ラテックスアレルギー'],
  ['flightWithin48h', '48時間以内にフライト'],
  ['alcoholToday', '当日飲酒'],
  ['alcoholLastNight', '前日飲酒'],
]
type Detector = {
  detect(video: HTMLVideoElement): Promise<{ rawValue?: string }[]>
}
type DetectorWindow = Window & {
  BarcodeDetector?: new (options?: { formats: string[] }) => Detector
}

function ScanContent() {
  const user = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [query, setQuery] = useState(
    searchParams.get('token') ?? searchParams.get('id') ?? ''
  )
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireData[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [result, setResult] = useState<QuestionnaireData | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [customerLoadError, setCustomerLoadError] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const [candidates, setCandidates] = useState<QuestionnaireData[]>([])
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [loading, setLoading] = useState(true)
  const [cameraOn, setCameraOn] = useState(false)
  const [added, setAdded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [checkInMethod, setCheckInMethod] = useState<'QR読取' | '手動照合'>(
    '手動照合'
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qs, rs] = await Promise.all([
        fetchQuestionnaires(),
        fetchReservations(),
      ])
      const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Tokyo',
      })
      const ids = new Set(
        rs.filter((r) => r.diveDate === today).map((r) => r.id)
      )
      setQuestionnaires(qs.filter((q) => ids.has(q.reservationId)))
      setReservations(rs)
      setError('')
    } catch {
      setError('問診データを読み込めませんでした。通信状態を確認してください。')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (user === undefined) return
    if (!user) {
      router.push('/login')
      return
    }
    load()
    const timer = window.setInterval(load, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [user, router, load])

  const lookup = useCallback(
    (value: string, method: 'QR読取' | '手動照合' = '手動照合') => {
      const q = value.trim()
      setQuery(q)
      setCandidates([])
      setResult(null)
      setAdded(false)
      setSelectedCustomerId('')
      setResolveError('')
      setCustomerLoadError(false)
      setError('')
      if (!q) return
      setCheckInMethod(method)
      const found = questionnaires.find(
        (item) => item.qrToken === q || item.id === q
      )
      if (!found) {
        setError('MSG-11：該当する問診情報が見つかりません。')
        return
      }
      if (found.qrUsed) {
        setError('MSG-22：このQRコードは受付済みです。')
        return
      }
      if (
        (found.qrToken === q || method === 'QR読取') &&
        (!Number.isFinite(Date.parse(found.qrExpiresAt || '')) ||
          Date.parse(found.qrExpiresAt!) <= Date.now())
      ) {
        setError(
          'MSG-10：QRコードの有効期限が切れています。受付にお申し出ください。'
        )
        return
      }
      setResult(found)
      setSelectedCustomerId(found.customerId ?? '')
      if (found.staffReviewStatus === '要対応') {
        void fetchCustomers().then(setCustomers).catch(() => setCustomerLoadError(true))
      }
    },
    [questionnaires]
  )
  useEffect(() => {
    const initial = searchParams.get('token') ?? searchParams.get('id')
    if (initial && questionnaires.length)
      lookup(initial, searchParams.get('token') ? 'QR読取' : '手動照合')
  }, [questionnaires, searchParams, lookup])

  async function startCamera() {
    setCameraError('')
    const DetectorClass = (window as DetectorWindow).BarcodeDetector
    if (!DetectorClass) {
      setCameraError(
        'このブラウザはQR読取に対応していません。手動検索をご利用ください。'
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })
      streamRef.current = stream
      setCameraOn(true)
    } catch {
      setCameraError(
        'カメラを起動できませんでした。権限を確認するか、手動検索をご利用ください。'
      )
    }
  }
  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }
  useEffect(() => {
    if (!cameraOn || !streamRef.current || !videoRef.current) return
    const video = videoRef.current
    const stream = streamRef.current
    const DetectorClass = (window as DetectorWindow).BarcodeDetector
    if (!DetectorClass) return
    let active = true
    video.srcObject = stream
    const detector = new DetectorClass({ formats: ['qr_code'] })
    const scan = async () => {
      if (!active) return
      try {
        const codes = await detector.detect(video)
        const value = codes[0]?.rawValue
        if (value) {
          stopCamera()
          lookup(value, 'QR読取')
          return
        }
      } catch {
        /* 次フレームで再試行 */
      }
      if (active) window.requestAnimationFrame(scan)
    }
    video
      .play()
      .then(() => window.requestAnimationFrame(scan))
      .catch(() => setCameraError('カメラ映像を再生できませんでした。'))
    return () => {
      active = false
      video.pause()
      video.srcObject = null
    }
  }, [cameraOn, lookup])
  useEffect(() => () => stopCamera(), [])

  function manualSearch(e: React.FormEvent) {
    e.preventDefault()
    const term = query.trim()
    if (!term) {
      setError('氏名または電話番号を入力してください。')
      setCandidates([])
      setResult(null)
      return
    }
    const exact = questionnaires.find(
      (q) => q.qrToken === term || q.id === term
    )
    if (exact) {
      lookup(term, exact.qrToken === term ? 'QR読取' : '手動照合')
      return
    }
    const found = questionnaires.filter((q) => matchesQuestionnaire(q, term))
    if (found.length === 0) {
      setError('MSG-11：該当する問診情報が見つかりません。')
      setCandidates([])
      setResult(null)
    } else if (found.length === 1)
      lookup(found[0].qrToken || found[0].id, '手動照合')
    else {
      setCheckInMethod('手動照合')
      setError('候補から問診情報を選択してください。')
      setCandidates(found)
      setResult(null)
    }
  }
  async function handleAdd() {
    if (!result) return
    setAdding(true)
    try {
      await addRoster({
        questionnaireId: result.id,
        method: checkInMethod,
        qrToken: checkInMethod === 'QR読取' ? result.qrToken : undefined,
      })
      setAdded(true)
      setResult({ ...result, qrUsed: true })
    } catch {
      setError('名簿への追加に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setAdding(false)
    }
  }

  async function resolveExistingCustomer() {
    if (!result || result.staffReviewStatus !== '要対応' || !selectedCustomerId) return
    const customer = customers.find((item) => item.id === selectedCustomerId)
    if (!customer) {
      setResolveError('顧客を選択してください。')
      return
    }
    const guestName = `${result.lastName} ${result.firstName}`
    const customerName = `${customer.lastName} ${customer.firstName}`
    if (!window.confirm(
      `${guestName} 様の問診票を、本人確認した顧客 ${customer.id}（${customerName}）へ反映します。健康情報と顧客プロフィールを更新し、この予約の来店回数を一度だけ加算します。よろしいですか？`
    )) return

    setResolving(true)
    setResolveError('')
    try {
      const response = await fetch('/api/questionnaires', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionnaireId: result.id, customerId: customer.id }),
      })
      const data = await response.json() as { error?: string; questionnaire?: QuestionnaireData }
      if (!response.ok) throw new Error(data.error ?? '顧客台帳への反映に失敗しました。')
      const updated = data.questionnaire ?? await fetchQuestionnaireById(result.id)
      setResult(updated)
      setQuestionnaires((prev) => prev.map((q) => q.id === updated.id ? updated : q))
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : '顧客台帳への反映に失敗しました。')
    } finally {
      setResolving(false)
    }
  }
  const reservation =
    result && reservations.find((r) => r.id === result.reservationId)
  const alerts = result
    ? HEALTH_FLAGS.filter(([key]) => result[key] === true)
    : []
  if (user === undefined || loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
        読み込み中…
      </div>
    )
  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-gray-800 flex-1">
            📷 QRコード読取・問診確認
          </h1>
          <button
            onClick={load}
            className="text-xs border rounded-lg px-2 py-1"
          >
            更新
          </button>
        </div>
        <section className="bg-white rounded-xl border p-4 space-y-3">
          <button
            onClick={cameraOn ? stopCamera : startCamera}
            className="w-full bg-ocean-600 text-white py-3 rounded-lg font-medium"
          >
            {cameraOn ? 'カメラを停止' : '📷 カメラを起動'}
          </button>
          {cameraOn && (
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full rounded-lg bg-black aspect-video object-cover"
            />
          )}
          {cameraError && (
            <p className="text-sm text-orange-700 bg-orange-50 p-3 rounded-lg">
              {cameraError}
            </p>
          )}
          <form onSubmit={manualSearch} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="氏名・電話番号・QRトークン"
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button className="bg-gray-700 text-white px-4 rounded-lg text-sm">
              検索
            </button>
          </form>
          <p className="text-xs text-gray-500">
            当日分の問診を事前ロード済み。読取時はキャッシュから照合します。
          </p>
        </section>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {candidates.length > 0 && (
          <section className="bg-white rounded-xl border divide-y">
            {candidates.map((q) => (
              <button
                key={q.id}
                onClick={() => lookup(q.qrToken || q.id)}
                className="w-full text-left p-3 hover:bg-gray-50"
              >
                <b>
                  {q.lastName} {q.firstName}
                </b>
                <span className="ml-3 text-sm text-gray-500">{q.phone}</span>
              </button>
            ))}
          </section>
        )}
        {result && (
          <section className="space-y-4">
            {result.staffReviewStatus === '要対応' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <p className="text-sm text-amber-900">
                  {result.staffReviewNotes || 'この問診票は本人確認が必要です。内容を確認してください。'}
                </p>
                <div>
                  <label htmlFor="review-customer" className="block text-sm font-medium text-amber-950 mb-1">
                    本人確認後、反映する顧客を選択
                  </label>
                  <select id="review-customer" value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    disabled={resolving || customerLoadError}
                    className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-800">
                    <option value="">顧客IDを選択してください</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.id} · {customer.lastName} {customer.firstName} · {customer.phone}
                      </option>
                    ))}
                  </select>
                </div>
                {customerLoadError && (
                  <p role="alert" className="text-sm text-red-700">顧客一覧を取得できませんでした。ページを再読み込みしてください。</p>
                )}
                {resolveError && <p role="alert" className="text-sm text-red-700">{resolveError}</p>}
                <button onClick={() => void resolveExistingCustomer()}
                  disabled={resolving || !selectedCustomerId || customerLoadError}
                  className="w-full rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {resolving ? '顧客台帳へ反映中…' : '本人確認して顧客台帳へ反映'}
                </button>
              </div>
            )}
            {result.staffReviewStatus === '確認済' && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
                {result.staffReviewNotes || '本人確認済みで、顧客台帳へ反映されています。'}
              </div>
            )}
            {alerts.length > 0 && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
                <p className="font-bold text-red-700 mb-2">⚠️ 要注意項目</p>
                <ul className="text-sm text-red-700 space-y-1">
                  {alerts.map(([, label]) => (
                    <li key={label}>
                      ・{label}
                      {label === '服薬中' && result.medicationName
                        ? `（${result.medicationName}）`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="bg-ocean-600 text-white px-4 py-3">
                <p className="font-bold text-lg">
                  {result.lastName} {result.firstName}
                </p>
                <p className="text-sm opacity-80">
                  {result.lastNameKana} {result.firstNameKana}
                </p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <I label="生年月日" value={result.birthDate} />
                <I label="電話番号" value={result.phone} />
                <I
                  label="体調"
                  value={
                    result.condition === 'good'
                      ? '😊 良い'
                      : result.condition === 'normal'
                        ? '😐 普通'
                        : '😔 悪い'
                  }
                />
                <I
                  label="睡眠時間"
                  value={
                    result.sleepCategory ||
                    (result.sleepHours == null
                      ? '未回答'
                      : `${result.sleepHours}時間`)
                  }
                />
                <I
                  label="Cカード"
                  value={
                    result.hasCCard
                      ? `${result.cCardType}（${result.cCardOrg}）`
                      : 'なし'
                  }
                />
                <I
                  label="総本数"
                  value={
                    result.totalDives == null
                      ? '未回答'
                      : `${result.totalDives}本`
                  }
                />
                <I
                  label="フライト予定"
                  value={result.flightWithin48h ? 'あり' : 'なし'}
                />
                <I
                  label="前回のダイブ"
                  value={
                    result.lastDivePeriod || result.lastDiveDate || '未回答'
                  }
                />
                <I label="体調の詳細" value={result.conditionDetails || '－'} />
                <I
                  label="医師許可書（自己申告）"
                  value={
                    result.medicalCertificate === undefined
                      ? '未回答'
                      : result.medicalCertificate
                        ? 'あり'
                        : 'なし'
                  }
                />
                <I
                  label="許可書（スタッフ確認）"
                  value={result.doctorClearance || '未確認'}
                />
                <I label="予約コース" value={reservation?.courseName ?? '-'} />
              </div>
            </div>
            <div className="bg-white rounded-xl border p-4 text-sm space-y-1">
              <p>住所：{result.address}</p>
              <p>
                緊急連絡先：{result.emergencyName}（{result.emergencyRelation}）{' '}
                {result.emergencyPhone}
              </p>
              <p>
                同意：リスク {result.agreeRisk ? '✅' : '❌'} ／医療処置{' '}
                {result.agreeMedical ? '✅' : '❌'} ／写真{' '}
                {result.agreePhoto ? '✅' : '⬜'}
              </p>
            </div>
            <StaffQuestionnaireCheck
              key={result.id}
              questionnaire={result}
              onSaved={(updated) => {
                setResult(updated)
                setQuestionnaires((prev) =>
                  prev.map((q) => (q.id === updated.id ? updated : q))
                )
              }}
            />
            <button
              disabled={adding || added}
              onClick={handleAdd}
              className="w-full bg-green-600 disabled:bg-gray-300 text-white py-3 rounded-lg font-medium"
            >
              {adding
                ? '追加中…'
                : added
                  ? '✅ 名簿に追加しました'
                  : '名簿へ追加'}
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
function I({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  )
}
export default function ScanPage() {
  return (
    <Suspense>
      <ScanContent />
    </Suspense>
  )
}
