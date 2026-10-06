import { describe, it, expect } from 'vitest'
import { validateNewReservationInput } from '../reservationValidation'

const validInput = {
  guestName: 'テスト太郎',
  guestPhone: '090-0000-1111',
  guestEmail: 'test@example.com',
  diveDate: '2026-09-10',
  courseId: 'CRS-001',
  guestCount: 2,
  channel: 'phone',timeSlot:'morning',
}

describe('validateNewReservationInput', () => {
  it('正常な入力ではエラーが出ない', () => {
    expect(validateNewReservationInput(validInput)).toMatchObject({ok:true})
  })

  it('必須項目が欠けているとエラーになる', () => {
    const result = validateNewReservationInput({}); const errors = result.ok ? [] : Object.keys(result.fields)
    expect(errors).toContain('guestName')
    expect(errors).toContain('guestPhone')
    expect(errors).toContain('courseId')
    expect(errors).toContain('channel')
    expect(result).toMatchObject({ok:false,fields:{diveDate:expect.any(String)}})
  })

  it('ダイブ日の形式が不正だとエラーになる', () => {
    const result = validateNewReservationInput({ ...validInput, diveDate: '2026/09/10' })
    expect(result).toMatchObject({ok:false,fields:{diveDate:expect.any(String)}})
  })

  it.each([0, -1, 1.5])('参加人数が%iのように1以上の整数でないとエラーになる', (guestCount) => {
    const errors = validateNewReservationInput({ ...validInput, guestCount })
    expect(errors).toMatchObject({ok:false,fields:{guestCount:expect.any(String)}})
  })

  it('参加人数が1以上の整数なら通る', () => {
    expect(validateNewReservationInput({ ...validInput, guestCount: 1 })).toMatchObject({ok:true})
  })

  it('メールアドレスの欠落を入力欄に紐づけて返す', () => {
    const { guestEmail, ...rest } = validInput
    expect(validateNewReservationInput(rest)).toMatchObject({ok:false,fields:{guestEmail:expect.any(String)}})
  })

  it('メールアドレスの形式が不正だとエラーになる', () => {
    const errors = validateNewReservationInput({ ...validInput, guestEmail: 'not-an-email' })
    expect(errors).toMatchObject({ok:false,fields:{guestEmail:expect.any(String)}})
  })
})
