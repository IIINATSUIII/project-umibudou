import { describe, it, expect } from 'vitest'
import { validateReservationInput } from '../reservationValidation'

const validInput = {
  guestName: 'テスト太郎',
  guestPhone: '090-0000-1111',
  guestEmail: 'test@example.com',
  diveDate: '2026-09-10',
  courseId: 'CRS-001',
  guestCount: 2,
  channel: 'phone',
}

describe('validateReservationInput', () => {
  it('正常な入力ではエラーが出ない', () => {
    expect(validateReservationInput(validInput)).toEqual([])
  })

  it('必須項目が欠けているとエラーになる', () => {
    const errors = validateReservationInput({})
    expect(errors).toContain('代表者名は必須です')
    expect(errors).toContain('電話番号は必須です')
    expect(errors).toContain('コースは必須です')
    expect(errors).toContain('予約経路は必須です')
    expect(errors).toContain('ダイブ日はYYYY-MM-DD形式で必須です')
  })

  it('ダイブ日の形式が不正だとエラーになる', () => {
    const errors = validateReservationInput({ ...validInput, diveDate: '2026/09/10' })
    expect(errors).toContain('ダイブ日はYYYY-MM-DD形式で必須です')
  })

  it.each([0, -1, 1.5])('参加人数が%iのように1以上の整数でないとエラーになる', (guestCount) => {
    const errors = validateReservationInput({ ...validInput, guestCount })
    expect(errors).toContain('参加人数は1以上の整数で必須です')
  })

  it('参加人数が1以上の整数なら通る', () => {
    expect(validateReservationInput({ ...validInput, guestCount: 1 })).toEqual([])
  })

  it('メールアドレスが未入力なら許容される（任意項目）', () => {
    const { guestEmail, ...rest } = validInput
    expect(validateReservationInput(rest)).toEqual([])
  })

  it('メールアドレスの形式が不正だとエラーになる', () => {
    const errors = validateReservationInput({ ...validInput, guestEmail: 'not-an-email' })
    expect(errors).toContain('メールアドレスの形式が正しくありません')
  })
})
