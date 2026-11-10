'use client'

import { useEffect, useState } from 'react'
import { checkCutout, cutOutFish } from '@/lib/fish/browserCutout'
import type { CutoutVerdict } from '@/lib/fish/cutout'

type Choice = 'sprite' | 'bubble'

/**
 * 水槽で泳がせる姿を、利用者に選んでもらう確認画面。
 * 写真から魚を切り抜き、「この姿で泳がせる」か「泡に包んで泳がせる」かを選ぶ。
 * 切り抜きは、サンゴなど背景だけを切り抜いてしまうことがあるので、必ず人の目で確認してもらう。
 */
export default function SpriteChooser({
  photo,
  expectedSpeciesId,
  originalProbability,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  /** 縮小済みの写真 */
  photo: Blob
  /** 判定で決めた魚（わからないときは null）。切り抜きが魚か確かめる目安に使う */
  expectedSpeciesId: number | null
  originalProbability: number
  confirmLabel: string
  /** sprite = 切り抜き画像、null = 泡 */
  onConfirm: (sprite: Blob | null) => void | Promise<void>
  onCancel: () => void
}) {
  const [state, setState] = useState<'working' | 'ready'>('working')
  const [sprite, setSprite] = useState<Blob | null>(null)
  const [verdict, setVerdict] = useState<CutoutVerdict>('unknown')
  const [choice, setChoice] = useState<Choice>('bubble')
  const [urls, setUrls] = useState<{ photo: string; sprite: string | null }>({ photo: '', sprite: null })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const photoUrl = URL.createObjectURL(photo)
    let spriteUrl: string | null = null
    ;(async () => {
      const cut = await cutOutFish(photo).catch(() => null)
      const result = cut ? await checkCutout(cut, expectedSpeciesId, originalProbability) : 'unknown'
      if (cancelled) return
      spriteUrl = cut ? URL.createObjectURL(cut) : null
      setSprite(cut)
      setVerdict(result)
      // 魚として怪しいときは、泡を初期の選択にする。切り抜けなかったときも泡
      setChoice(cut && result !== 'doubtful' ? 'sprite' : 'bubble')
      setUrls({ photo: photoUrl, sprite: spriteUrl })
      setState('ready')
    })()
    return () => {
      cancelled = true
      URL.revokeObjectURL(photoUrl)
      if (spriteUrl) URL.revokeObjectURL(spriteUrl)
    }
  }, [photo, expectedSpeciesId, originalProbability])

  async function confirm() {
    setSaving(true)
    try {
      await onConfirm(choice === 'sprite' ? sprite : null)
    } finally {
      setSaving(false)
    }
  }

  if (state === 'working') {
    return (
      <div role="status" data-testid="chooser-working" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-center text-sm text-slate-600">
        魚を切り抜いています…
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3" data-testid="chooser">
      <p className="text-sm font-semibold text-slate-800">水槽で泳ぐ姿を選んでください</p>
      <div className="grid grid-cols-2 gap-2">
        <figure className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls.photo} alt="撮った写真" className="h-36 w-full object-contain" />
          <figcaption className="bg-white py-1 text-center text-xs text-slate-500">撮った写真</figcaption>
        </figure>
        <figure className="overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-b from-sky-300 to-sky-700">
          {urls.sprite ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls.sprite} alt="切り抜いた魚" data-testid="chooser-sprite" className="h-36 w-full object-contain" />
          ) : (
            <span className="flex h-36 items-center justify-center px-2 text-center text-xs text-white">うまく切り抜けませんでした</span>
          )}
          <figcaption className="bg-white py-1 text-center text-xs text-slate-500">切り抜いた魚</figcaption>
        </figure>
      </div>

      {sprite && verdict === 'doubtful' && (
        <p role="note" data-testid="chooser-doubtful" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
          ⚠ 魚ではなく、背景（サンゴなど）を切り抜いたかもしれません。魚の姿でなければ、「泡」を選んでください。
        </p>
      )}
      {!sprite && <p className="text-xs text-slate-600">背景が複雑だったり、魚が小さかったりして、切り抜けませんでした。泡に包んで泳がせます。</p>}

      <fieldset className="space-y-1.5">
        <legend className="sr-only">水槽で泳ぐ姿</legend>
        <label className={`flex items-center gap-2 rounded-lg border bg-white p-2 text-sm ${!sprite ? 'opacity-50' : ''} ${choice === 'sprite' ? 'border-sky-500' : 'border-slate-200'}`}>
          <input type="radio" name="swim-look" value="sprite" checked={choice === 'sprite'} disabled={!sprite} onChange={() => setChoice('sprite')} />
          🐟 この姿で泳がせる
        </label>
        <label className={`flex items-center gap-2 rounded-lg border bg-white p-2 text-sm ${choice === 'bubble' ? 'border-sky-500' : 'border-slate-200'}`}>
          <input type="radio" name="swim-look" value="bubble" checked={choice === 'bubble'} onChange={() => setChoice('bubble')} />
          🫧 泡に包んで泳がせる
        </label>
      </fieldset>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={saving} data-testid="chooser-cancel"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">やめる</button>
        <button type="button" onClick={() => void confirm()} disabled={saving} data-testid="chooser-confirm"
          className="rounded-xl bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
          {saving ? '保存中…' : confirmLabel}
        </button>
      </div>
    </div>
  )
}
