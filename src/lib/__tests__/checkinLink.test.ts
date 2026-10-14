import { describe, it, expect } from 'vitest'
import {
  buildCheckinPath,
  readCheckinParams,
  parseCheckinInput,
  loadSavedCheckins,
  saveCheckin,
  clearSavedCheckins,
  CHECKIN_STORAGE_KEY,
} from '../checkinLink'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
  }
}

describe('buildCheckinPath / readCheckinParams', () => {
  it('予約番号と確認コードをURLに含め、読み取りで元に戻る', () => {
    const path = buildCheckinPath('R-20261016-abc', 'tok_en-123')

    expect(path.startsWith('/line-menu/checkin?')).toBe(true)
    const params = new URL(path, 'https://example.com').searchParams
    expect(readCheckinParams(params)).toEqual({
      reservationId: 'R-20261016-abc',
      reservationToken: 'tok_en-123',
    })
  })

  it('記号を含む値もURLエンコードされ、そのまま復元できる', () => {
    const path = buildCheckinPath('R-1&x=y', 'a+b/c=')

    const params = new URL(path, 'https://example.com').searchParams
    expect(readCheckinParams(params)).toEqual({ reservationId: 'R-1&x=y', reservationToken: 'a+b/c=' })
  })

  it('どちらかが無い・空の場合は null', () => {
    expect(readCheckinParams(new URLSearchParams(''))).toBeNull()
    expect(readCheckinParams(new URLSearchParams('reservationId=R-1'))).toBeNull()
    expect(readCheckinParams(new URLSearchParams('token=abc'))).toBeNull()
    expect(readCheckinParams(new URLSearchParams('reservationId=%20&token=abc'))).toBeNull()
  })
})

describe('parseCheckinInput(貼り付けた文字列から確認コードを取り出す)', () => {
  it('受付QRの確認リンク（予約番号つき）から両方を取り出す', () => {
    const link = `https://example.com${buildCheckinPath('R-1', 'tok-AAAA')}`

    expect(parseCheckinInput(link)).toEqual({ reservationId: 'R-1', reservationToken: 'tok-AAAA' })
  })

  it('問診票のURL（/questionnaire/確認コード）からも確認コードを取り出す', () => {
    expect(parseCheckinInput('https://example.com/questionnaire/tok-AAAA')).toEqual({ reservationToken: 'tok-AAAA' })
    expect(parseCheckinInput('/questionnaire/tok%2BBB/')).toEqual({ reservationToken: 'tok+BB' })
  })

  it('token= だけのURLも受け付け、確認コードそのものも受け付ける', () => {
    expect(parseCheckinInput('https://example.com/x?token=tok-CCCC')).toEqual({ reservationToken: 'tok-CCCC' })
    expect(parseCheckinInput('  tok-DDDD  ')).toEqual({ reservationToken: 'tok-DDDD' })
  })

  it('空・空白を含む文章・読み取れないURLは null', () => {
    expect(parseCheckinInput('')).toBeNull()
    expect(parseCheckinInput('これは 文章 です')).toBeNull()
    expect(parseCheckinInput('https://example.com/other')).toBeNull()
    expect(parseCheckinInput('https://example.com/questionnaire/scan')).toBeNull()
  })
})

describe('保存済みの予約（端末のブラウザ内）', () => {
  const entry = (n: number) => ({ reservationId: `R-${n}`, reservationToken: `tok-${n}`, diveDate: '2026-10-20' })

  it('保存して、新しい順に読み出せる', () => {
    const storage = memoryStorage()
    saveCheckin(storage, entry(1), 1000)
    saveCheckin(storage, entry(2), 2000)

    expect(loadSavedCheckins(storage).map((e) => e.reservationId)).toEqual(['R-2', 'R-1'])
  })

  it('同じ確認コードは重複させず、最新の内容で上書きする', () => {
    const storage = memoryStorage()
    saveCheckin(storage, entry(1), 1000)
    saveCheckin(storage, { ...entry(1), diveDate: '2026-11-01' }, 2000)

    const saved = loadSavedCheckins(storage)
    expect(saved).toHaveLength(1)
    expect(saved[0].diveDate).toBe('2026-11-01')
  })

  it('最大5件まで。古いものから消える', () => {
    const storage = memoryStorage()
    for (let i = 1; i <= 7; i++) saveCheckin(storage, entry(i), i * 1000)

    const ids = loadSavedCheckins(storage).map((e) => e.reservationId)
    expect(ids).toEqual(['R-7', 'R-6', 'R-5', 'R-4', 'R-3'])
  })

  it('壊れたデータ・不正な項目は読み飛ばし、例外にしない', () => {
    expect(loadSavedCheckins(memoryStorage({ [CHECKIN_STORAGE_KEY]: '{broken' }))).toEqual([])
    expect(loadSavedCheckins(memoryStorage({ [CHECKIN_STORAGE_KEY]: '{"a":1}' }))).toEqual([])
    const mixed = JSON.stringify([{ reservationId: 'R-1' }, { ...entry(2), savedAt: 5 }])
    expect(loadSavedCheckins(memoryStorage({ [CHECKIN_STORAGE_KEY]: mixed })).map((e) => e.reservationId)).toEqual(['R-2'])
  })

  it('保存できない環境（storage なし・例外）でも画面を壊さない', () => {
    expect(loadSavedCheckins(undefined)).toEqual([])
    expect(() => saveCheckin(undefined, entry(1))).not.toThrow()
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(loadSavedCheckins(throwing)).toEqual([])
    expect(() => saveCheckin(throwing, entry(1))).not.toThrow()
    expect(() => clearSavedCheckins(throwing)).not.toThrow()
  })

  it('クリアすると空になる', () => {
    const storage = memoryStorage()
    saveCheckin(storage, entry(1))
    clearSavedCheckins(storage)

    expect(loadSavedCheckins(storage)).toEqual([])
  })
})
