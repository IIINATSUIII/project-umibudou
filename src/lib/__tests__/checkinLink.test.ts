import { describe, it, expect } from 'vitest'
import { buildCheckinPath, readCheckinParams } from '../checkinLink'

describe('checkinLink', () => {
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

  it('どちらかが無い・空の場合は null（手入力の画面にする）', () => {
    expect(readCheckinParams(new URLSearchParams(''))).toBeNull()
    expect(readCheckinParams(new URLSearchParams('reservationId=R-1'))).toBeNull()
    expect(readCheckinParams(new URLSearchParams('token=abc'))).toBeNull()
    expect(readCheckinParams(new URLSearchParams('reservationId=%20&token=abc'))).toBeNull()
  })
})
