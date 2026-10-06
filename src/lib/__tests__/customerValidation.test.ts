import { describe, it, expect } from 'vitest'
import type { Customer } from '@/types'
import { validateCustomerUpdate, pickEditableFields, isValidEmail } from '../customerValidation'

function fakeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'C-0001',
    lastName: '田中', firstName: '花子', lastNameKana: 'タナカ', firstNameKana: 'ハナコ',
    phone: '090-1234-5678', email: 'tanaka@example.com',
    lastVisit: '2026-06-20', visitCount: 1,
    hasCCard: false, cCardType: '', totalDives: 0,
    healthNotes: '', guideNotes: '',
    ...overrides,
  } as Customer
}

describe('isValidEmail', () => {
  it.each(['a@example.com', 'foo.bar@sub.example.co.jp'])('%sは正しい形式', (v) => {
    expect(isValidEmail(v)).toBe(true)
  })
  it.each(['not-an-email', 'a@', '@example.com', ''])('%sは不正な形式', (v) => {
    expect(isValidEmail(v)).toBe(false)
  })
})

describe('pickEditableFields', () => {
  it('編集可能な列だけを取り出し、前後の空白を除去する', () => {
    expect(pickEditableFields({ lastName: '  田中  ', id: 'C-9999', visitCount: 999 }))
      .toEqual({ lastName: '田中' })
  })

  it('hasCCardは文字列"true"もboolean trueに変換する', () => {
    expect(pickEditableFields({ hasCCard: 'true' })).toEqual({ hasCCard: true })
  })

  it('totalDivesは数値に変換する', () => {
    expect(pickEditableFields({ totalDives: '150' })).toEqual({ totalDives: 150 })
  })
})

describe('validateCustomerUpdate', () => {
  const current = fakeCustomer()

  it('差分が空ならエラーもなし（ガイドメモのみの保存等）', () => {
    expect(validateCustomerUpdate({}, current)).toEqual({})
  })

  it('姓名は必須かつ50文字以内', () => {
    expect(validateCustomerUpdate({ lastName: '' }, current).lastName).toBeTruthy()
    expect(validateCustomerUpdate({ lastName: 'あ'.repeat(51) }, current).lastName).toBeTruthy()
    expect(validateCustomerUpdate({ lastName: '山田' }, current).lastName).toBeUndefined()
  })

  it('カナは全角カタカナでなければエラー', () => {
    expect(validateCustomerUpdate({ lastNameKana: 'たなか' }, current).lastNameKana).toBeTruthy()
    expect(validateCustomerUpdate({ lastNameKana: 'タナカ' }, current).lastNameKana).toBeUndefined()
  })

  it('電話番号は10〜11桁の数字・ハイフンのみ', () => {
    expect(validateCustomerUpdate({ phone: '090-123-456' }, current).phone).toBeTruthy() // 9桁
    expect(validateCustomerUpdate({ phone: '090-1234-5678' }, current).phone).toBeUndefined()
  })

  it('メールアドレスは形式チェック＋他顧客との重複チェック', () => {
    const others = [fakeCustomer({ id: 'C-0002', email: 'other@example.com' })]
    expect(validateCustomerUpdate({ email: 'not-an-email' }, current, others).email).toBeTruthy()
    expect(validateCustomerUpdate({ email: 'OTHER@example.com' }, current, others).email).toBeTruthy()
    expect(validateCustomerUpdate({ email: 'new@example.com' }, current, others).email).toBeUndefined()
  })

  it('空メールは既存データ互換のため許容する', () => {
    expect(validateCustomerUpdate({ email: '' }, current).email).toBeUndefined()
  })

  it('Cカードありなら種別が必須で、許容値以外はエラー', () => {
    expect(validateCustomerUpdate({ hasCCard: true }, current).cCardType).toBeTruthy()
    expect(validateCustomerUpdate({ hasCCard: true, cCardType: 'FOO' }, current).cCardType).toBeTruthy()
    expect(validateCustomerUpdate({ hasCCard: true, cCardType: 'AOW' }, current).cCardType).toBeUndefined()
  })

  it('総ダイビング本数は0〜99999の整数', () => {
    expect(validateCustomerUpdate({ totalDives: -1 }, current).totalDives).toBeTruthy()
    expect(validateCustomerUpdate({ totalDives: 1.5 }, current).totalDives).toBeTruthy()
    expect(validateCustomerUpdate({ totalDives: 100000 }, current).totalDives).toBeTruthy()
    expect(validateCustomerUpdate({ totalDives: 150 }, current).totalDives).toBeUndefined()
  })

  it('備考・ガイドメモは1000文字以内', () => {
    expect(validateCustomerUpdate({ guideNotes: 'あ'.repeat(1001) }, current).guideNotes).toBeTruthy()
    expect(validateCustomerUpdate({ guideNotes: 'あ'.repeat(1000) }, current).guideNotes).toBeUndefined()
  })
})
