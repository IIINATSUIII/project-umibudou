'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { SPECIES, cautionFor } from '@/lib/fish/classify'
import { buildProgress, sortNewestFirst, type CollectionEntry } from '@/lib/fish/collection'
import { CollectionStore, isCollectionSupported } from '@/lib/fish/collectionStore'
import SpriteChooser from '../SpriteChooser'

type Tab = 'zukan' | 'album'

/** 保存した写真（Blob）を、画面に出すための URL にする。使い終わったら解放する。 */
function usePhotoUrls(entries: readonly CollectionEntry[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const created = new Map(entries.map((entry) => [entry.id, URL.createObjectURL(entry.photo)]))
    setUrls(created)
    return () => created.forEach((url) => URL.revokeObjectURL(url))
  }, [entries])
  return urls
}

const speciesName = (id: number | null) => (id === null ? 'わからない・対応外' : SPECIES[id]?.ja ?? 'わからない・対応外')

export default function FishCollectionPage() {
  const store = useRef<CollectionStore | null>(null)
  const [entries, setEntries] = useState<CollectionEntry[] | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('zukan')
  const [selected, setSelected] = useState<CollectionEntry | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  // 水槽で泳ぐ姿を選び直している最中か
  const [choosingLook, setChoosingLook] = useState(false)
  const [notice, setNotice] = useState('')
  // IndexedDB が使えるかは、ブラウザで表示したあとに調べる（サーバーが作る最初の画面と食い違わないように）
  const [supported, setSupported] = useState<boolean | null>(null)

  const reload = useCallback(async () => {
    try {
      store.current ??= new CollectionStore()
      setEntries(sortNewestFirst(await store.current.list()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'コレクションを読み込めませんでした。')
      setEntries([])
    }
  }, [])

  useEffect(() => {
    const available = isCollectionSupported()
    setSupported(available)
    if (available) void reload()
    else setEntries([])
    return () => {
      void store.current?.close()
      store.current = null
    }
  }, [reload])

  // 別の写真を選んだら、姿の選び直しはやめる
  useEffect(() => {
    setChoosingLook(false)
    setNotice('')
  }, [selected?.id])

  const urls = usePhotoUrls(entries ?? [])
  const progress = useMemo(() => buildProgress(entries ?? []), [entries])
  const speciesEntries = (id: number) => (entries ?? []).filter((entry) => entry.speciesId === id)

  async function remove(id: string) {
    try {
      await store.current?.remove(id)
      setSelected(null)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '削除できませんでした。')
    }
  }

  async function changeLook(entry: CollectionEntry, sprite: Blob | null) {
    try {
      await store.current?.setSprite(entry.id, sprite)
      setChoosingLook(false)
      setNotice(sprite ? '水槽で泳ぐ姿を変えました。' : '水槽では、泡に包んで泳ぎます。')
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '変更できませんでした。')
    }
  }

  async function clearAll() {
    try {
      await store.current?.clear()
      setConfirmingClear(false)
      setSelected(null)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '削除できませんでした。')
    }
  }

  const percent = Math.round((progress.found / progress.total) * 100)

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu/fish" className="text-sm font-medium text-teal-800 hover:underline">← おさかな図鑑へ</Link>
        <header className="mb-5 mt-5 text-center">
          <h1 className="text-2xl font-bold text-slate-900">📚 コレクション</h1>
          <p className="mt-2 text-sm text-slate-600">撮った魚の写真と、見つけた魚の記録です。この端末の中だけに保存されています。</p>
        </header>

        {supported === false && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            この端末（ブラウザ）では、コレクションを保存できません。プライベートブラウズを使っている場合は、通常のブラウザで開いてください。
          </p>
        )}
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {entries === null ? (
          <p role="status" className="text-center text-sm text-slate-500">読み込み中…</p>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="進み具合">
              <p className="text-center text-3xl font-bold text-sky-800" data-testid="progress">
                {progress.found}<span className="text-lg font-semibold text-slate-500"> / {progress.total}種</span>
              </p>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={progress.found} aria-valuemin={0} aria-valuemax={progress.total}>
                <div className="h-full bg-teal-600" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">
                写真 {entries.length}枚{progress.unclassified > 0 ? `（うち魚がわからない写真 ${progress.unclassified}枚）` : ''}
              </p>
            </section>

            {entries.length > 0 && (
              <Link href="/line-menu/fish/aquarium" data-testid="aquarium-link"
                className="mt-3 flex items-center justify-between rounded-2xl bg-gradient-to-r from-sky-500 to-teal-500 p-4 text-white shadow-sm transition hover:brightness-105">
                <span className="font-bold">🐠 マイ水槽で泳がせる</span>
                <span className="text-xs opacity-90">タップで名前・エサやり →</span>
              </Link>
            )}

            <div role="tablist" aria-label="表示の切り替え" className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              {(['zukan', 'album'] as const).map((key) => (
                <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setSelected(null); setChoosingLook(false); setNotice('') }} data-testid={`tab-${key}`}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === key ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {key === 'zukan' ? '🐟 図鑑' : '🖼 アルバム'}
                </button>
              ))}
            </div>

            {tab === 'zukan' ? (
              <section className="mt-4" aria-label="図鑑">
                <ol className="grid grid-cols-3 gap-2" data-testid="zukan-grid">
                  {progress.slots.map((slot, index) => {
                    const photo = slot.cover ? urls.get(slot.cover.id) : undefined
                    return (
                      <li key={slot.species.id}>
                        <button type="button" disabled={!slot.cover} data-testid={slot.cover ? 'slot-found' : 'slot-empty'}
                          onClick={() => slot.cover && setSelected(slot.cover)}
                          className={`flex h-full w-full flex-col overflow-hidden rounded-xl border text-left ${slot.cover ? 'border-teal-300 bg-white shadow-sm' : 'border-dashed border-slate-300 bg-slate-100'}`}>
                          <span className="relative block aspect-square w-full bg-slate-200">
                            {photo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={photo} alt={slot.species.ja} className="h-full w-full object-cover" />
                            ) : (
                              <span className="flex h-full items-center justify-center text-2xl text-slate-400" aria-hidden="true">？</span>
                            )}
                            {slot.count > 1 && <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] text-white">×{slot.count}</span>}
                          </span>
                          <span className="p-1.5">
                            <span className="block text-[10px] text-slate-400">No.{index + 1}</span>
                            <span className={`block truncate text-xs font-semibold ${slot.cover ? 'text-slate-800' : 'text-slate-400'}`}>
                              {slot.cover ? slot.species.ja : '？？？'}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ) : (
              <section className="mt-4" aria-label="アルバム">
                {entries.length === 0 ? (
                  <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">まだ写真がありません。おさかな図鑑で魚を判定して、「コレクションに追加」を押してください。</p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2" data-testid="album-grid">
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <button type="button" onClick={() => setSelected(entry)} data-testid="album-item" className="block w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm">
                          <span className="block aspect-square w-full bg-slate-200">
                            {urls.get(entry.id) && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={urls.get(entry.id)} alt={speciesName(entry.speciesId)} className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="block truncate p-1.5 text-xs font-semibold text-slate-800">{speciesName(entry.speciesId)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {selected && (
              <section className="mt-4 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm" aria-label="写真の詳細" data-testid="detail">
                {urls.get(selected.id) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(selected.id)} alt={speciesName(selected.speciesId)} className="max-h-80 w-full rounded-xl object-contain bg-slate-100" />
                )}
                <p className="mt-3 text-lg font-bold text-slate-900">{speciesName(selected.speciesId)}</p>
                {selected.speciesId !== null && SPECIES[selected.speciesId] && (
                  <p className="text-xs italic text-slate-500">{SPECIES[selected.speciesId].scientific}</p>
                )}
                {selected.speciesId !== null && cautionFor(speciesName(selected.speciesId)) && (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-950">⚠ {cautionFor(speciesName(selected.speciesId))}</p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(selected.createdAt).toLocaleString('ja-JP')} に追加・{selected.source === 'ai' ? '判定の結果から' : '自分で選んだ魚'}
                  {selected.speciesId !== null && ` ・この魚の写真 ${speciesEntries(selected.speciesId).length}枚`}
                </p>
                {choosingLook ? (
                  <div className="mt-3">
                    <SpriteChooser
                      photo={selected.photo}
                      expectedSpeciesId={selected.speciesId}
                      originalProbability={selected.topProbability}
                      confirmLabel="この姿にする"
                      onConfirm={(sprite) => changeLook(selected, sprite)}
                      onCancel={() => setChoosingLook(false)}
                    />
                  </div>
                ) : (
                  <button type="button" onClick={() => { setChoosingLook(true); setNotice('') }} data-testid="choose-look"
                    className="mt-3 w-full rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100">
                    🐠 水槽での姿を選ぶ
                  </button>
                )}
                {notice && <p role="status" className="mt-2 text-xs text-emerald-700">{notice}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSelected(null)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">閉じる</button>
                  <button type="button" onClick={() => void remove(selected.id)} data-testid="delete-one"
                    className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">この写真を削除</button>
                </div>
              </section>
            )}

            {entries.length > 0 && (
              <section className="mt-6 text-center">
                {confirmingClear ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <p>コレクションの写真を<b>すべて</b>削除します。元に戻せません。</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setConfirmingClear(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700">やめる</button>
                      <button type="button" onClick={() => void clearAll()} data-testid="clear-confirm" className="rounded-lg bg-red-600 px-3 py-2 font-semibold text-white">すべて削除</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmingClear(true)} data-testid="clear-all" className="text-xs text-slate-500 underline">コレクションをすべて削除する</button>
                )}
              </section>
            )}

            <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
              写真は、このブラウザの中だけに保存され、サーバーには送られません。ブラウザのデータを消したり、別の端末・別のブラウザ（LINEの中と通常のブラウザなど）で開いたりすると、見えなくなります。
            </p>
          </>
        )}
      </div>
    </main>
  )
}
