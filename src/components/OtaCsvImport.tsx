'use client'

import { useState } from 'react'
import { importOtaCsv, type OtaCsvImportResult, type OtaCsvRow } from '@/lib/api'

const MAX_FILE_BYTES = 2 * 1024 * 1024

const STATUS_LABELS: Record<OtaCsvRow['status'], { label: string; className: string }> = {
  ready: { label: '取込予定', className: 'bg-blue-50 text-blue-700' },
  imported: { label: '取込済', className: 'bg-green-50 text-green-700' },
  duplicate: { label: '重複', className: 'bg-gray-100 text-gray-600' },
  invalid: { label: '不正', className: 'bg-red-50 text-red-700' },
}

/** OTAのCSVはUTF-8とShift_JISが混在するため、UTF-8として読めなければShift_JISで読む */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('shift_jis').decode(bytes)
  }
}

/**
 * 予約管理（SC-03）の「CSV取込」。ファイル選択 → 確認（保存しない判定） → 取込 → 結果表示。
 * 不正・重複の行は取り込まず、行番号と理由を表示する（MSG-14）。
 */
export default function OtaCsvImport({ onImported }: { onImported: () => void }) {
  const [fileName, setFileName] = useState('')
  const [csv, setCsv] = useState('')
  const [result, setResult] = useState<OtaCsvImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setFileName('')
    setCsv('')
    setResult(null)
    setError('')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    reset()
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) {
      setError('CSVファイルの形式が正しくありません。 ファイルが大きすぎます（2MBまで）')
      return
    }
    setBusy(true)
    try {
      const text = decodeCsvBytes(await file.arrayBuffer())
      setCsv(text)
      setResult(await importOtaCsv(text, true))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSVを読み込めませんでした')
    } finally {
      setBusy(false)
    }
  }

  async function handleImport() {
    setBusy(true)
    setError('')
    try {
      const imported = await importOtaCsv(csv, false)
      setResult(imported)
      if (imported.imported > 0) onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSVを取り込めませんでした')
    } finally {
      setBusy(false)
    }
  }

  const open = Boolean(fileName)
  const problemRows = result?.rows.filter((row) => row.status === 'invalid' || row.status === 'duplicate') ?? []

  return (
    <>
      <label className="cursor-pointer text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
        📥 CSV取込
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      </label>

      {open && (
        <section aria-label="CSV取込" className="basis-full bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-800 text-sm break-all">📥 {fileName}</h2>
            <button type="button" onClick={reset} className="text-xs text-gray-500 underline shrink-0">閉じる</button>
          </div>

          {busy && <p className="text-sm text-gray-500">処理中…</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          {result && (
            <>
              <p className="text-sm text-gray-700">
                {result.dryRun
                  ? `取込予定 ${result.ready}件`
                  : `${result.imported}件を取り込みました`}
                ／ 重複 {result.duplicates}件 ／ 不正 {result.invalid}件
              </p>
              {result.invalid > 0 && (
                <p role="alert" className="text-sm text-red-700">
                  CSVファイルの形式が正しくありません。不正な行は取り込みません。内容を確認してください。
                </p>
              )}

              {problemRows.length > 0 && (
                <ul className="text-xs divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
                  {problemRows.map((row) => (
                    <li key={row.line} className="px-3 py-2 flex gap-2">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded ${STATUS_LABELS[row.status].className}`}>
                        {STATUS_LABELS[row.status].label}
                      </span>
                      <span className="min-w-0">
                        <span className="font-mono">{row.line}行目</span>
                        {row.guestName && ` ${row.guestName}`}
                        {row.diveDate && ` ${row.diveDate}`}
                        <span className="block text-gray-600">{row.messages.join('／')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                {result.dryRun && result.ready > 0 && (
                  <button type="button" onClick={handleImport} disabled={busy}
                    className="bg-ocean-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-ocean-700 disabled:opacity-50">
                    {result.ready}件を取り込む
                  </button>
                )}
                {result.dryRun && result.ready === 0 && (
                  <p className="text-sm text-gray-600">取り込める予約はありません。</p>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  )
}
