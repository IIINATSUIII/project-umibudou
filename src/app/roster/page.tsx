'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuth } from '@/lib/authContext'
import { fetchRoster } from '@/lib/api'
import type { RosterEntry } from '@/types'

function toCsv(rows: RosterEntry[]): string {
  const headers = [
    '氏名', '氏名（カナ）', '生年月日', '年齢', '性別', '住所', '電話番号',
    '緊急連絡先', '緊急連絡先電話番号', 'ダイブ日', 'コース', '担当スタッフ', '受付日時', '受付方法',
  ]
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = rows.map((r) => [
    r.name,
    r.nameKana,
    r.birthDate,
    String(r.age),
    r.gender,
    r.address,
    r.phone,
    r.emergencyContact,
    r.emergencyPhone,
    r.diveDate,
    r.course,
    r.staffName,
    new Date(r.checkedInAt).toLocaleString('ja-JP'),
    r.checkInMethod,
  ].map(escape).join(','))
  // 先頭にBOMを付けてExcelでの文字化けを防ぐ
  return '﻿' + [headers.map(escape).join(','), ...lines].join('\r\n')
}

export default function RosterPage() {
  const user = useAuth()
  const router = useRouter()
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState('')
  const [courseFilter, setCourseFilter] = useState('')

  useEffect(() => {
    if (user === undefined) return
    if (!user) { router.push('/login'); return }
    fetchRoster().then((data) => { setRoster(data); setLoading(false) })
  }, [user, router])

  const courses = useMemo(
    () => Array.from(new Set(roster.map((r) => r.course).filter(Boolean))),
    [roster]
  )

  const filtered = roster
    .filter((r) => !dateFilter || r.diveDate === dateFilter)
    .filter((r) => !courseFilter || r.course === courseFilter)
    .sort((a, b) => a.diveDate.localeCompare(b.diveDate) || a.checkedInAt.localeCompare(b.checkedInAt))

  function handleCsvExport() {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `名簿_${dateFilter || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handlePdfExport() {
    // 専用ライブラリを追加せず、印刷用レイアウトからブラウザの「PDFに保存」機能を利用する
    window.print()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">読み込み中…</div>

  return (
    <div className="min-h-screen">
      <div className="print:hidden">
        <Navigation />
      </div>
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 md:pb-6 space-y-4 print:p-0 print:max-w-none">

        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <h1 className="text-xl font-bold text-gray-800 flex-1">📋 名簿エクスポート</h1>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
          />
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
          >
            <option value="">すべてのコース</option>
            {courses.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={handleCsvExport}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
            📥 CSV出力
          </button>
          <button onClick={handlePdfExport}
            className="bg-ocean-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-ocean-700 transition-colors">
            🖨️ PDF出力
          </button>
        </div>

        <p className="text-xs text-gray-400 print:hidden">
          {filtered.length}件 ／ 沖縄水上安全条例の備付け要件に基づく参加者名簿（永続化済みの記録のみ表示）
        </p>

        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto print:border-none">
          {filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-12 text-sm">対象の名簿データはありません</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  {['氏名', 'カナ', '生年月日', '年齢', '性別', '住所', '電話番号', '緊急連絡先', 'ダイブ日', 'コース', '担当', '受付日時', '方法'].map((h) => (
                    <th key={h} className="text-left px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-800">{r.name}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.nameKana}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.birthDate}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.age}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.gender}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.address}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{r.phone}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.emergencyContact} / {r.emergencyPhone}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.diveDate}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.course}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.staffName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(r.checkedInAt).toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.checkInMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  )
}
