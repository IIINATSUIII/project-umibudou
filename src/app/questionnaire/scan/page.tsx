'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchQuestionnaires } from '@/lib/api'
import type { QuestionnaireData } from '@/types'

const HEALTH_FLAGS: [keyof QuestionnaireData, string][] = [
  ['heartDisease', '心臓・循環器系疾患'],
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
  const [qId, setQId] = useState(searchParams.get('id') ?? '')
  const [result, setResult] = useState<QuestionnaireData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [allQs, setAllQs] = useState<QuestionnaireData[]>([])

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    fetchQuestionnaires().then((data) => {
      setAllQs(data)
      const id = searchParams.get('id')
      if (id) lookup(id, data)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, router])

  function lookup(id: string, qs: QuestionnaireData[] = allQs) {
    setNotFound(false)
    setResult(null)
    const found = qs.find((q) => q.id === id)
    if (found) setResult(found)
    else setNotFound(true)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    lookup(qId.trim())
  }

  const alerts = result ? HEALTH_FLAGS.filter(([key]) => result[key] === true) : []

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4">
        <h1 className="text-xl font-bold text-gray-800">📷 QRコード読取・問診確認</h1>

        <form onSubmit={handleSearch} className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-2">問診票IDを入力してください（QRコードをスキャン後に自動入力）</p>
          <div className="flex gap-2">
            <input value={qId} onChange={(e) => setQId(e.target.value)}
              placeholder="Q1234567890"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 font-mono" />
            <button type="submit"
              className="bg-ocean-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ocean-700 transition-colors">
              確認
            </button>
          </div>
        </form>

        {notFound && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            問診票が見つかりませんでした。IDをご確認ください。
          </div>
        )}

        {result && (
          <div className="space-y-4">
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
