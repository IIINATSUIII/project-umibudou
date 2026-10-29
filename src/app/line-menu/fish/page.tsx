'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { SPECIES, cautionFor, type FishResult } from '@/lib/fish/classify'
import { classifyPhoto, loadModel } from '@/lib/fish/browserClassifier'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

type ModelState = 'loading' | 'ready' | 'error'
type Result = FishResult & { milliseconds: number }

export default function FishGuidePage() {
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [modelState, setModelState] = useState<ModelState>('loading')
  const [judging, setJudging] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  // 画面を開いたら、判定モデルを先に読み込む（初回だけ時間がかかる。次回からは、ブラウザが覚えている）
  useEffect(() => {
    let active = true
    loadModel()
      .then(() => active && setModelState('ready'))
      .catch((cause) => {
        if (!active) return
        setModelState('error')
        setError(cause instanceof Error ? cause.message : '判定の準備に失敗しました。')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!image) {
      setPreview('')
      return
    }
    const objectUrl = URL.createObjectURL(image)
    setPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [image])

  async function judge(file: File) {
    setJudging(true)
    setResult(null)
    try {
      setResult(await classifyPhoto(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '判定できませんでした。別の写真でお試しください。')
    } finally {
      setJudging(false)
    }
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    event.target.value = ''
    setError('')
    setResult(null)
    if (!selected) return
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setImage(null)
      setError('JPG、PNG、WebP、GIF形式の写真を選んでください。')
    } else if (selected.size > MAX_IMAGE_BYTES) {
      setImage(null)
      setError('写真は12MB以下にしてください。')
    } else {
      setImage(selected)
      if (modelState === 'ready') void judge(selected)
    }
  }

  // 写真を選んだあとにモデルの準備が終わった場合も、そのまま判定する
  useEffect(() => {
    if (modelState === 'ready' && image && !result && !judging) void judge(image)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelState])

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu" className="text-sm font-medium text-teal-800 hover:underline">← メニューへ</Link>
        <header className="mb-6 mt-5 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-600 text-3xl text-white shadow" aria-hidden="true">🐠</div>
          <h1 className="mt-4 text-2xl font-bold text-slate-900">おさかな図鑑</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            魚の写真を撮るか選ぶと、近い魚を3つ表示します。判定はこの端末の中だけで行い、写真は外へ送信しません。
          </p>
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
              <p className="mt-1 text-xs text-slate-500">JPG・PNG・WebP・GIF／12MBまで</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => cameraInput.current?.click()}
              className="rounded-xl bg-teal-700 px-3 py-3 text-sm font-semibold text-white transition hover:bg-teal-800">📷 カメラで撮る</button>
            <button type="button" onClick={() => libraryInput.current?.click()}
              className="rounded-xl border border-teal-700 px-3 py-3 text-sm font-semibold text-teal-800 transition hover:bg-teal-50">🖼 写真を選ぶ</button>
          </div>

          {modelState === 'loading' && (
            <p role="status" data-testid="model-status" className="text-center text-xs text-slate-500">判定の準備をしています…（初回は、少し時間がかかります）</p>
          )}
          {modelState === 'ready' && !judging && !result && (
            <p role="status" data-testid="model-status" className="text-center text-xs text-slate-500">準備ができました。写真を選ぶと、すぐに判定します。</p>
          )}
          {judging && <p role="status" className="text-center text-sm text-slate-600">判定中…</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          {result && (
            <div aria-live="polite" data-testid="fish-result" className="space-y-3">
              {!result.confident && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  ⚠ 自信がありません。対応している75種ではない魚か、写真が不鮮明かもしれません。以下は参考です。
                </p>
              )}
              {result.candidates.map((candidate, index) => (
                <div key={candidate.species.id} data-testid="fish-candidate">
                  <p className="font-bold text-slate-900">
                    {index + 1}. {candidate.species.ja}{' '}
                    <span className="text-xs font-normal text-slate-500">{(candidate.probability * 100).toFixed(1)}%</span>
                  </p>
                  <p className="text-xs italic text-slate-500">{candidate.species.scientific}</p>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-teal-700" style={{ width: `${Math.max(1, candidate.probability * 100)}%` }} />
                  </div>
                  {candidate.caution && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-950">⚠ {candidate.caution}</p>
                  )}
                </div>
              ))}
              <p className="text-xs text-slate-500">結果は目安です（判定にかかった時間: {(result.milliseconds / 1000).toFixed(2)}秒）。</p>
            </div>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">🐟 対応している魚（{SPECIES.length}種）</summary>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              沖縄で記録の多い順です。<b>これ以外の魚は、正しく答えられません</b>（近い別の魚の名前が出ることがあります）。⚠は、毒・とげ・かみつきの注意がある魚です。
            </p>
            <ol className="mt-3 columns-2 gap-4 text-sm">
              {SPECIES.map((species, index) => (
                <li key={species.id} className="flex break-inside-avoid gap-2 border-b border-slate-100 py-1.5">
                  <span className="w-6 shrink-0 text-right text-xs text-slate-400">{index + 1}</span>
                  <span>
                    <b>{species.ja}</b>{cautionFor(species.ja) ? ' ⚠' : ''}
                    <br />
                    <span className="text-xs italic text-slate-500">{species.scientific}</span>
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </section>

        <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
          判定モデルは、iNaturalist の観察写真（利用者が撮影・確認したもの）と、BioCLIP 2 の判定を使って、学習しています。授業での利用を想定しており、営利目的での利用はできません。
        </p>
      </div>
    </main>
  )
}
