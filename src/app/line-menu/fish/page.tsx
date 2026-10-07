'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export default function FishGuidePage() {
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!image) {
      setPreview('')
      return
    }
    const objectUrl = URL.createObjectURL(image)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [image])

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setError('')
    if (!selected) return
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setImage(null)
      setError('JPG、PNG、WebP、GIF形式の写真を選んでください。')
    } else if (selected.size > MAX_IMAGE_BYTES) {
      setImage(null)
      setError('写真は4MB以下にしてください。')
    } else {
      setImage(selected)
    }
    event.target.value = ''
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu" className="text-sm font-medium text-teal-800 hover:underline">← メニューへ</Link>
        <header className="mb-6 mt-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-600 text-3xl text-white shadow" aria-hidden="true">🐠</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">おさかな図鑑</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">魚の写真を撮るか選んで、判定の準備ができます。</p>
        </header>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <input ref={cameraInput} type="file" accept={ACCEPTED_TYPES.join(',')} capture="environment" className="hidden" onChange={selectImage} />
          <input ref={libraryInput} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={selectImage} />
          {preview ? (
            <div className="relative h-80 overflow-hidden rounded-xl bg-slate-100">
              <Image src={preview} alt="選択した魚の写真" fill unoptimized sizes="(max-width: 448px) 100vw, 448px" className="object-contain" />
            </div>
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-sky-200 bg-sky-50 text-center">
              <span className="text-4xl" aria-hidden="true">🌊</span>
              <p className="mt-2 text-sm font-medium text-slate-700">魚が写った写真を選んでください</p>
              <p className="mt-1 text-xs text-slate-500">JPG・PNG・WebP・GIF／4MBまで</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => cameraInput.current?.click()}
              className="rounded-xl bg-teal-700 px-3 py-3 text-sm font-semibold text-white transition hover:bg-teal-800">📷 カメラで撮る</button>
            <button type="button" onClick={() => libraryInput.current?.click()}
              className="rounded-xl border border-teal-700 px-3 py-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-50">🖼 写真を選ぶ</button>
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
            <p className="font-semibold">AI判定サービスは未接続です</p>
            <p className="mt-1">選んだ写真はこの端末でのプレビューにだけ使い、外部へ送信していません。判定機能を有効にするには、写真を外部AIへ送ることと利用料金について事前の確認が必要です。</p>
          </div>
          <button type="button" disabled
            className="w-full cursor-not-allowed rounded-xl bg-slate-300 px-4 py-3 font-semibold text-slate-600">
            {image ? 'AI判定（サービス未接続）' : '写真を選ぶと判定できます'}
          </button>
        </section>
      </div>
    </main>
  )
}
