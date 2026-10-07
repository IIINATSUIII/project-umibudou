'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchCustomers, fetchQuestionnaireById, fetchQuestionnaires } from '@/lib/api'
import type { Customer, QuestionnaireData, QuestionnaireSummary } from '@/types'

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike

const HEALTH_FLAGS: [keyof QuestionnaireData, string][] = [
  ['heartDisease', '心臓・循環器系疾患'],
  ['highBloodPressure', '高血圧'],
  ['respiratoryDisease', '呼吸器系疾患'],
  ['earDisease', '耳・副鼻腔の疾患'],
  ['epilepsy', 'てんかん・失神'],
  ['diabetes', '糖尿病'],
  ['pregnant', '妊娠中'],
  ['panicDisorder', 'パニック障害・閉所恐怖症'],
  ['medication', '服薬中'],
  ['latexAllergy', 'ラテックスアレルギー'],
  ['flightWithin48h', '48時間以内にフライト'],
]

function ScanContent() {
  const user = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QuestionnaireData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [matches, setMatches] = useState<QuestionnaireSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [expiredQr, setExpiredQr] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [customerLoadError, setCustomerLoadError] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [checkinMessage, setCheckinMessage] = useState<{ text: string; already: boolean } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const scanBusyRef = useRef(false)

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    const initialToken = searchParams.get('token')
    const initialId = searchParams.get('id')
    if (initialToken) void processQrValue(initialToken)
    else if (initialId) {
      setQuery(initialId)
      void lookup(initialId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, router, searchParams])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  function stopCamera() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOpen(false)
  }

  async function startCamera() {
    setCameraError('')
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    if (!Detector) {
      setCameraError('このブラウザーはカメラでのQR読取に対応していません。ChromeまたはEdgeで開いてください。')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('カメラを利用できません。HTTPSで開いていることをご確認ください。')
      return
    }

    setCameraBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const video = videoRef.current
      if (!video) throw new Error('カメラ映像を開始できませんでした。')
      video.srcObject = stream
      await video.play()

      const detector = new Detector({ formats: ['qr_code'] })
      const scanFrame = async () => {
        if (!streamRef.current || scanBusyRef.current) return
        try {
          const codes = await detector.detect(video)
          const code = codes.find((item) => item.rawValue.trim())
          if (code) {
            void processQrValue(code.rawValue)
            return
          }
        } catch {
          // フレームが不鮮明な間は次のフレームで再試行する。
        }
        if (streamRef.current) frameRef.current = window.requestAnimationFrame(() => void scanFrame())
      }
      frameRef.current = window.requestAnimationFrame(() => void scanFrame())
    } catch (error) {
      stopCamera()
      setCameraError(error instanceof Error && error.name === 'NotAllowedError'
        ? 'カメラの使用が許可されていません。ブラウザーの設定でカメラを許可してください。'
        : 'カメラを起動できませんでした。ブラウザーのカメラ権限をご確認ください。')
    } finally {
      setCameraBusy(false)
    }
  }

  async function processQrValue(rawValue: string) {
    if (scanBusyRef.current) return
    scanBusyRef.current = true
    stopCamera()
    setCameraError('')
    setCheckinMessage(null)

    let token = rawValue.trim()
    try {
      const url = new URL(token)
      token = url.searchParams.get('token') ?? token
    } catch {
      // LINEの受付QRはURLではなく、参加者ごとのランダムなトークンを格納する。
    }

    setQuery(token)
    setResult(null)
    setNotFound(false)
    setSearchError(false)
    setExpiredQr(false)
    setCameraBusy(true)
    try {
      const response = await fetch('/api/questionnaires/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json() as {
        error?: string
        questionnaireId?: string
        alreadyCheckedIn?: boolean
      }
      if (!response.ok) {
        if (response.status === 410) setExpiredQr(true)
        else setCameraError(data.error ?? '受付用QRコードを確認できませんでした。')
        return
      }
      if (!data.questionnaireId) {
        setCameraError('受付情報を確認できませんでした。')
        return
      }
      setCheckinMessage({
        text: data.alreadyCheckedIn ? 'この参加者はすでに受付済みです。' : '受付を記録しました。',
        already: Boolean(data.alreadyCheckedIn),
      })
      await selectQuestionnaire(data.questionnaireId)
    } catch {
      setCameraError('受付を記録できませんでした。通信状態を確認して再度お試しください。')
    } finally {
      setCameraBusy(false)
      scanBusyRef.current = false
    }
  }

  async function lookup(searchTerm: string) {
    setNotFound(false)
    setSearchError(false)
    setExpiredQr(false)
    setResult(null)
    setMatches([])
    if (!searchTerm.trim()) return

    setSearching(true)
    try {
      const found = await fetchQuestionnaires(searchTerm.trim())
      setMatches(found)
      if (found.length === 1) await selectQuestionnaire(found[0].id)
      else if (found.length === 0) setNotFound(true)
    } catch (error) {
      if (error instanceof Error && error.message === 'QR_EXPIRED') setExpiredQr(true)
      else setSearchError(true)
    } finally {
      setSearching(false)
    }
  }

  async function selectQuestionnaire(id: string) {
    setSearchError(false)
    setResolveError('')
    setCustomerLoadError(false)
    setResult(null)
    setSearching(true)
    try {
      const questionnaire = await fetchQuestionnaireById(id)
      setResult(questionnaire)
      setSelectedCustomerId(questionnaire.customerId ?? '')
      if (questionnaire.staffReviewStatus === '要対応') {
        try {
          setCustomers(await fetchCustomers())
        } catch {
          setCustomerLoadError(true)
        }
      }
    } catch {
      setSearchError(true)
    } finally {
      setSearching(false)
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
      setResult(data.questionnaire ?? await fetchQuestionnaireById(result.id))
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : '顧客台帳への反映に失敗しました。')
    } finally {
      setResolving(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setCheckinMessage(null)
    void lookup(query)
  }

  const alerts = result ? HEALTH_FLAGS.filter(([key]) => result[key] === true) : []

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">📷 QRコード読取・問診確認</h1>

        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <p className="text-sm text-gray-700">お客様のLINEに表示された受付QRを読み取ります。読み取り後、自動で受付済みに記録します。</p>
          <button type="button" onClick={() => cameraOpen ? stopCamera() : void startCamera()}
            disabled={cameraBusy && !cameraOpen}
            className="w-full bg-ocean-600 text-white px-4 py-3 rounded-lg text-sm font-semibold hover:bg-ocean-700 disabled:opacity-50">
            {cameraOpen ? 'カメラを閉じる' : cameraBusy ? '準備中…' : 'カメラで受付QRを読み取る'}
          </button>
          {cameraOpen && (
            <video ref={videoRef} muted playsInline className="w-full rounded-lg bg-black" aria-label="受付QR読取カメラ" />
          )}
          <p className="text-xs text-gray-500">カメラを使うには、HTTPSで開き、ブラウザーのカメラ使用を許可してください。</p>
          {cameraError && <p role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{cameraError}</p>}
        </section>

        <form onSubmit={handleSearch} className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-2">問診票ID・予約ID・QRトークン・氏名・電話番号で検索できます</p>
          <div className="flex gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="M-0001 / 氏名 / 電話番号"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 font-mono" />
            <button type="submit" disabled={searching || !query.trim()}
              className="bg-ocean-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ocean-700 transition-colors">
              {searching ? '検索中…' : '検索'}
            </button>
          </div>
        </form>

        {checkinMessage && (
          <div role="status" className={`rounded-xl border p-4 text-sm ${checkinMessage.already ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-green-50 border-green-200 text-green-800'}`}>
            <p className="font-semibold">{checkinMessage.text}</p>
          </div>
        )}

        {searchError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            検索に失敗しました。時間をおいて再度お試しください。
          </div>
        )}

        {expiredQr && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            QRコードの有効期限が切れています。受付で本人確認を行ってください。
          </div>
        )}

        {notFound && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            問診票が見つかりませんでした。入力内容をご確認ください。
          </div>
        )}

        {matches.length > 1 && !result && (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {matches.map((questionnaire) => (
              <button key={questionnaire.id} onClick={() => void selectQuestionnaire(questionnaire.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50">
                <span className="block font-medium text-gray-800">{questionnaire.lastName} {questionnaire.firstName}</span>
                <span className="block text-xs text-gray-500">{questionnaire.lastNameKana} {questionnaire.firstNameKana} · {questionnaire.phone} · {questionnaire.id}</span>
              </button>
            ))}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {result.staffReviewStatus === '要対応' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <p className="text-sm text-amber-900">
                  {result.staffReviewNotes || 'この問診票は本人確認が必要です。スタッフが内容を確認してください。'}
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
            {result.qrExpiresAt && new Date(result.qrExpiresAt).getTime() <= Date.now() && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                QRコードの有効期限が切れています。受付で本人確認を行ってください。
              </div>
            )}
            {alerts.length > 0 && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
                <p className="font-bold text-red-700 mb-2">⚠️ 注意事項あり</p>
                <ul className="space-y-1">
                  {alerts.map(([, label]) => (
                    <li key={label} className="text-sm text-red-700">
                      • {label}{label === '服薬中' && result.medicationName ? ` (${result.medicationName})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-ocean-600 text-white px-4 py-3">
                <p className="font-bold text-lg">{result.lastName} {result.firstName}</p>
                <p className="text-sm text-white/80">{result.lastNameKana} {result.firstNameKana}</p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <I label="生年月日" value={result.birthDate} />
                <I label="性別" value={result.gender === 'male' ? '男性' : result.gender === 'female' ? '女性' : 'その他'} />
                <I label="電話番号" value={result.phone} />
                <I label="体調" value={result.condition === 'good' ? '😊 良い' : result.condition === 'normal' ? '😐 普通' : '😔 悪い'} />
                <I label="睡眠時間" value={`${result.sleepHours}時間`} />
                <I label="提出日時" value={new Date(result.submittedAt).toLocaleString('ja-JP')} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">🆘 緊急連絡先</p>
              <p className="text-sm">{result.emergencyName}（{result.emergencyRelation}）</p>
              <p className="text-sm text-ocean-600 font-mono">{result.emergencyPhone}</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">🎓 経験・スキル</p>
              {result.hasCCard ? (
                <div className="space-y-1 text-sm">
                  <p>Cカード：{result.cCardType}（{result.cCardOrg}）</p>
                  <p>総本数：{result.totalDives} 本</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Cカードなし（体験ダイビング）</p>
              )}
              {result.lastDiveDate && <p className="text-sm mt-1">最後に潜った時期：{result.lastDiveDate}</p>}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">✅ 同意状況</p>
              <div className="space-y-1 text-sm">
                <p>{result.agreeRisk ? '✅' : '❌'} ダイビングリスクへの同意</p>
                <p>{result.agreeMedical ? '✅' : '❌'} 緊急医療処置への同意</p>
                <p>{result.agreePhoto ? '✅' : '⬜'} 写真・動画使用許可</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function I({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-gray-500">{label}</p><p className="text-sm font-medium text-gray-800">{value}</p></div>
}

export default function ScanPage() {
  return <Suspense><ScanContent /></Suspense>
}
