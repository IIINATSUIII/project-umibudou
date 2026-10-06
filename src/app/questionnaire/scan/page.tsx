'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchQuestionnaireById, fetchQuestionnaires } from '@/lib/api'
import type { QuestionnaireData, QuestionnaireSummary } from '@/types'

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

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    const initialQuery = searchParams.get('token') ?? searchParams.get('id')
    if (initialQuery) {
      setQuery(initialQuery)
      void lookup(initialQuery)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, router, searchParams])

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
    setResult(null)
    setSearching(true)
    try {
      setResult(await fetchQuestionnaireById(id))
    } catch {
      setSearchError(true)
    } finally {
      setSearching(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    void lookup(query)
  }

  const alerts = result ? HEALTH_FLAGS.filter(([key]) => result[key] === true) : []

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">📷 QRコード読取・問診確認</h1>

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
                <I label="性別" value={result.gender === 'male' ? '男性' : result.gender === 'female' ? '女性' : result.gender === 'other' ? 'その他' : '未回答'} />
                <I label="電話番号" value={result.phone} />
                <I label="体調" value={result.condition === 'good' ? '😊 良い' : result.condition === 'normal' ? '😐 普通' : '😔 悪い'} />
                <I label="睡眠時間" value={result.sleepCategory || (result.sleepHours == null ? '未回答' : result.sleepHours + '時間')} />
                <I label="体調詳細" value={result.conditionDetails || '記載なし'} />
                <I label="高血圧" value={result.highBloodPressure == null ? '未回答' : result.highBloodPressure ? 'あり' : 'なし'} />
                <I label="潜水許可書（本人申告）" value={result.medicalCertificate == null ? '未回答' : result.medicalCertificate ? '持参あり' : '持参なし'} />
                <I label="潜水許可書（スタッフ確認）" value={result.doctorClearance || '未確認'} />
                <I label="スタッフ確認状態" value={result.staffReviewStatus || '未確認'} />
                <I label="総本数" value={result.totalDives == null ? '未回答' : result.totalDives + '本'} />
                <I label="最終ダイビング" value={result.lastDivePeriod || result.lastDiveDate || '未回答'} />
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
                  <p>総本数：{result.totalDives ?? '未回答'} 本</p>
                  {result.lastDiveDate && <p>前回：{result.lastDiveDate}</p>}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Cカードなし（体験ダイビング）</p>
              )}
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
