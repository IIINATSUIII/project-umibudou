import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COLLECTION_MESSAGES,
  CollectionError,
  MAX_ENTRIES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIDE,
  buildProgress,
  countFound,
  downscaledSize,
  sortNewestFirst,
  validateNewEntry,
  type CollectionEntry,
} from '../fish/collection'
import { CollectionStore } from '../fish/collectionStore'
import { SPECIES } from '../fish/classify'

const photo = (bytes = 100) => new Blob([new Uint8Array(bytes).fill(1)], { type: 'image/jpeg' })
const entry = (over: Partial<CollectionEntry> = {}): CollectionEntry => ({
  id: 'e1',
  createdAt: 1000,
  speciesId: 0,
  source: 'ai',
  topProbability: 0.9,
  photo: photo(),
  ...over,
})

describe('validateNewEntry(追加してよい記録か)', () => {
  it('ふつうの記録は通す。魚がわからない(null)記録も通す', () => {
    expect(() => validateNewEntry({ speciesId: 3, photo: photo() }, 0)).not.toThrow()
    expect(() => validateNewEntry({ speciesId: null, photo: photo() }, 0)).not.toThrow()
  })

  it('上限に達していたら、断る（上限の1つ手前までは通す）', () => {
    expect(() => validateNewEntry({ speciesId: 0, photo: photo() }, MAX_ENTRIES - 1)).not.toThrow()
    expect(() => validateNewEntry({ speciesId: 0, photo: photo() }, MAX_ENTRIES)).toThrow(CollectionError)
  })

  it('範囲外・小数・負の魚の番号は断る', () => {
    for (const bad of [-1, SPECIES.length, 1.5, Number.NaN]) {
      expect(() => validateNewEntry({ speciesId: bad, photo: photo() }, 0)).toThrow(COLLECTION_MESSAGES.INVALID_SPECIES)
    }
  })

  it('空の写真・大きすぎる写真は断る', () => {
    expect(() => validateNewEntry({ speciesId: 0, photo: photo(0) }, 0)).toThrow(COLLECTION_MESSAGES.EMPTY_PHOTO)
    expect(() => validateNewEntry({ speciesId: 0, photo: photo(MAX_PHOTO_BYTES + 1) }, 0)).toThrow(COLLECTION_MESSAGES.PHOTO_TOO_LARGE)
  })

  it('断った理由を、コードでも取り出せる', () => {
    try {
      validateNewEntry({ speciesId: 0, photo: photo() }, MAX_ENTRIES)
    } catch (error) {
      expect((error as CollectionError).issue).toBe('LIMIT_REACHED')
    }
  })
})

describe('downscaledSize(保存前の縮小)', () => {
  it('小さい写真は、そのまま', () => {
    expect(downscaledSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(downscaledSize(MAX_PHOTO_SIDE, 100)).toEqual({ width: MAX_PHOTO_SIDE, height: 100 })
  })

  it('長い辺を上限にそろえて、縦横比を保つ', () => {
    expect(downscaledSize(4000, 3000)).toEqual({ width: MAX_PHOTO_SIDE, height: 720 })
    expect(downscaledSize(3000, 4000)).toEqual({ width: 720, height: MAX_PHOTO_SIDE })
  })

  it('極端に細長い写真でも、0にならない', () => {
    const { width, height } = downscaledSize(20000, 3)
    expect(width).toBe(MAX_PHOTO_SIDE)
    expect(height).toBeGreaterThanOrEqual(1)
  })
})

describe('buildProgress / countFound(図鑑のマス目と進み具合)', () => {
  it('何もないときは、0種。マスは75、すべて空', () => {
    const progress = buildProgress([])
    expect(progress.slots).toHaveLength(SPECIES.length)
    expect(progress.found).toBe(0)
    expect(progress.total).toBe(75)
    expect(progress.slots.every((s) => s.cover === null && s.count === 0)).toBe(true)
  })

  it('同じ魚を何枚撮っても、見つけた種類は1。表紙は一番新しい写真、枚数は数える', () => {
    const entries = [
      entry({ id: 'old', createdAt: 1, speciesId: 5 }),
      entry({ id: 'new', createdAt: 9, speciesId: 5 }),
      entry({ id: 'mid', createdAt: 5, speciesId: 5 }),
      entry({ id: 'other', createdAt: 2, speciesId: 7 }),
    ]

    const progress = buildProgress(entries)

    expect(progress.found).toBe(2)
    expect(progress.slots[5].count).toBe(3)
    expect(progress.slots[5].cover?.id).toBe('new')
    expect(progress.slots[7].cover?.id).toBe('other')
    expect(countFound(entries)).toBe(2)
  })

  it('魚がわからない写真は、種類には数えず、「未分類」として数える', () => {
    const progress = buildProgress([entry({ id: 'a', speciesId: null }), entry({ id: 'b', speciesId: null }), entry({ id: 'c', speciesId: 1 })])

    expect(progress.found).toBe(1)
    expect(progress.unclassified).toBe(2)
  })

  it('壊れた魚の番号の記録が混ざっていても、落ちずに、未分類に回す', () => {
    const progress = buildProgress([entry({ speciesId: 999 }), entry({ id: 'x', speciesId: -3 })])

    expect(progress.found).toBe(0)
    expect(progress.unclassified).toBe(2)
  })

  it('並べ替えは、元の配列を変えず、同じ時刻でも順番が安定する', () => {
    const input = [entry({ id: 'b', createdAt: 5 }), entry({ id: 'a', createdAt: 5 }), entry({ id: 'z', createdAt: 9 })]
    const before = input.map((e) => e.id)

    expect(sortNewestFirst(input).map((e) => e.id)).toEqual(['z', 'a', 'b'])
    expect(input.map((e) => e.id)).toEqual(before)
  })
})

describe('CollectionStore(端末の中への保存)', () => {
  let store: CollectionStore
  beforeEach(() => {
    store = new CollectionStore(new IDBFactory()) // テストごとに、まっさらな保存先
  })
  afterEach(async () => {
    await store.close()
  })

  const input = (over: Partial<Parameters<CollectionStore['add']>[0]> = {}) => ({
    speciesId: 2,
    source: 'ai' as const,
    topProbability: 0.8,
    photo: photo(500),
    ...over,
  })

  it('保存したものを、読み出せる（写真の中身も、そのまま）', async () => {
    const added = await store.add(input())

    const [saved] = await store.list()

    expect(saved.id).toBe(added.id)
    expect(saved.speciesId).toBe(2)
    expect(saved.source).toBe('ai')
    expect(saved.photo.size).toBe(500)
    expect(await store.count()).toBe(1)
  })

  it('別のオブジェクトで開き直しても、残っている（再読み込み・再起動のあとも見える）', async () => {
    const factory = new IDBFactory()
    const first = new CollectionStore(factory)
    await first.add(input({ speciesId: 4 }))
    await first.close()

    const second = new CollectionStore(factory)

    expect((await second.list()).map((e) => e.speciesId)).toEqual([4])
    await second.close()
  })

  it('1件だけ削除できる。ほかは残る', async () => {
    const a = await store.add(input({ speciesId: 1 }))
    await store.add(input({ speciesId: 2 }))

    await store.remove(a.id)

    expect((await store.list()).map((e) => e.speciesId)).toEqual([2])
  })

  it('すべて削除できる', async () => {
    await store.add(input())
    await store.add(input())

    await store.clear()

    expect(await store.count()).toBe(0)
  })

  it('不正な記録は保存せず、保存済みの件数も増えない', async () => {
    await expect(store.add(input({ speciesId: 500 }))).rejects.toBeInstanceOf(CollectionError)
    await expect(store.add(input({ photo: photo(0) }))).rejects.toBeInstanceOf(CollectionError)

    expect(await store.count()).toBe(0)
  })

  it(`${MAX_ENTRIES}枚の上限を超えて保存しない`, async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) await store.add(input({ photo: photo(10) }))

    await expect(store.add(input({ photo: photo(10) }))).rejects.toThrow(COLLECTION_MESSAGES.LIMIT_REACHED)

    expect(await store.count()).toBe(MAX_ENTRIES)
  }, 60000)

  it('切り抜き(sprite)も、写真といっしょに保存して読み出せる。切り抜けなかった(null)も区別して残す', async () => {
    await store.add(input({ speciesId: 1, sprite: photo(300) }))
    await store.add(input({ speciesId: 2, sprite: null }))
    await store.add(input({ speciesId: 3 }))

    const saved = await store.list()
    const bySpecies = (id: number) => saved.find((e) => e.speciesId === id)!

    expect(bySpecies(1).sprite?.size).toBe(300)
    expect(bySpecies(2).sprite).toBeNull()
    expect(bySpecies(3).sprite).toBeUndefined() // まだ試していない古い記録
  })

  it('あとから切り抜きを付けられる。ほかの項目と写真は変わらない', async () => {
    const added = await store.add(input({ speciesId: 4 }))

    await store.setSprite(added.id, photo(123))

    const [saved] = await store.list()
    expect(saved.sprite?.size).toBe(123)
    expect(saved.speciesId).toBe(4)
    expect(saved.photo.size).toBe(500)
    expect(saved.createdAt).toBe(added.createdAt)
  })

  it('切り抜けなかった(null)を、あとから記録できる。存在しない記録に対しては、何も作らない', async () => {
    const added = await store.add(input())

    await store.setSprite(added.id, null)
    await store.setSprite('no-such-id', photo(10))

    const saved = await store.list()
    expect(saved).toHaveLength(1)
    expect(saved[0].sprite).toBeNull()
  })

  it('追加した記録の id は、重ならない', async () => {
    const ids = new Set((await Promise.all([store.add(input()), store.add(input()), store.add(input())])).map((e) => e.id))

    expect(ids.size).toBe(3)
  })
})
