'use client'

import { useState } from 'react'
import { issueQuestionnaireUrl } from '@/lib/api'

export default function QuestionnaireUrlButton({
  reservationId,
  onError,
}: {
  reservationId: string
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function issue(action: 'open' | 'copy' | 'reissue') {
    if (busy) return
    if (
      action === 'reissue' &&
      !confirm('問診URLを再発行します。以前のURLは使えなくなります。')
    )
      return
    setBusy(true)
    try {
      const issued = await issueQuestionnaireUrl(
        reservationId,
        action === 'reissue'
      )
      if (!issued.questionnaireToken)
        throw new Error('URLの発行結果を確認できませんでした')
      const url = `${window.location.origin}/questionnaire/${encodeURIComponent(issued.questionnaireToken)}`
      if (action === 'open') window.location.assign(url)
      else {
        await navigator.clipboard.writeText(url)
        setMessage(
          action === 'reissue' ? '再発行してコピーしました' : 'コピーしました'
        )
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'URLを発行できませんでした')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap gap-2 text-xs text-ocean-600">
      <button disabled={busy} onClick={() => issue('open')}>
        問診を開く
      </button>
      <button disabled={busy} onClick={() => issue('copy')}>
        URLコピー
      </button>
      <button disabled={busy} onClick={() => issue('reissue')}>
        再発行
      </button>
      {message && <span role="status">{message}</span>}
    </div>
  )
}
