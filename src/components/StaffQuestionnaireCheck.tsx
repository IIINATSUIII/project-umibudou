'use client'

import { useState } from 'react'
import type { QuestionnaireData } from '@/types'

export default function StaffQuestionnaireCheck({
  questionnaire,
  onSaved,
}: {
  questionnaire: QuestionnaireData
  onSaved: (q: QuestionnaireData) => void
}) {
  const [doctorClearance, setClearance] = useState<
    NonNullable<QuestionnaireData['doctorClearance']>
  >(questionnaire.doctorClearance || '')
  const [staffCheckStatus, setStatus] = useState(
    questionnaire.staffCheckStatus || '未確認'
  )
  const [staffCheckNote, setNote] = useState(questionnaire.staffCheckNote || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  async function save() {
    if (saving) return
    setSaving(true)
    setMessage('')
    try {
      const delta = { doctorClearance, staffCheckStatus, staffCheckNote }
      const response = await fetch('/api/questionnaires', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: questionnaire.id, ...delta }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok !== true)
        throw new Error(body.error || '保存結果を確認できませんでした')
      onSaved({ ...questionnaire, ...delta })
      setMessage('保存しました')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存できませんでした')
    } finally {
      setSaving(false)
    }
  }
  return (
    <fieldset
      disabled={saving}
      className="bg-white rounded-xl border p-4 space-y-3 text-sm"
    >
      <legend className="font-semibold">スタッフ確認</legend>
      <label className="block">
        医師許可書の持参確認
        <select
          value={doctorClearance}
          onChange={(e) =>
            setClearance(e.target.value as typeof doctorClearance)
          }
          className="block w-full border rounded p-2"
        >
          <option value="">未確認</option>
          <option value="持参あり">持参あり</option>
          <option value="なし">なし</option>
        </select>
      </label>
      <label className="block">
        確認状態
        <select
          value={staffCheckStatus}
          onChange={(e) => setStatus(e.target.value as typeof staffCheckStatus)}
          className="block w-full border rounded p-2"
        >
          <option>未確認</option>
          <option>要対応</option>
          <option>確認済</option>
        </select>
      </label>
      <label className="block">
        スタッフメモ
        <textarea
          value={staffCheckNote}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          className="block w-full border rounded p-2"
        />
      </label>
      <button
        onClick={save}
        className="bg-ocean-600 text-white rounded px-4 py-2"
      >
        {saving ? '保存中…' : '確認内容を保存'}
      </button>
      {message && <p role="status">{message}</p>}
    </fieldset>
  )
}
