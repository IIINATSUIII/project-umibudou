import { describe, it, expect, vi } from 'vitest'
import type { Customer } from '@/types'
import {
  nextCustomerId,
  findExistingCustomer,
  validateCustomerKeys,
  buildHealthNotes,
  upsertCustomerFromQuestionnaire,
  type CustomerSource,
  type CustomerStore,
} from '../customerRegistration'

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

const validSource: CustomerSource = {
  lastName: '佐藤', firstName: '次郎', lastNameKana: 'サトウ', firstNameKana: 'ジロウ',
  birthDate: '1990-01-01', gender: 'male', address: '沖縄県那覇市', phone: '090-9999-8888',
  email: 'jiro@example.com', emergencyName: '佐藤 花子', emergencyRelation: '妻', emergencyPhone: '090-0000-0002',
  hasCCard: false, cCardType: '', cCardOrg: '', lastDiveDate: '', totalDives: 0,
  heartDisease: false, respiratoryDisease: false, earDisease: false, epilepsy: false,
  diabetes: false, medication: false, medicationName: '', latexAllergy: false,
}

describe('nextCustomerId', () => {
  it('顧客がいなければC-0001から採番する', () => {
    expect(nextCustomerId([])).toBe('C-0001')
  })

  it('既存の最大連番+1を採番する', () => {
    expect(nextCustomerId([fakeCustomer({ id: 'C-0001' }), fakeCustomer({ id: 'C-0003' })])).toBe('C-0004')
  })

  it('旧実装のタイムスタンプIDは連番の対象外として無視する', () => {
    expect(nextCustomerId([fakeCustomer({ id: 'C1700000000000' })])).toBe('C-0001')
  })
})

describe('findExistingCustomer', () => {
  const customers = [fakeCustomer({ id: 'C-0001', email: 'a@example.com', phone: '090-1111-2222' })]

  it('メールアドレス(大文字小文字を無視)で一致すれば見つかる', () => {
    expect(findExistingCustomer(customers, { email: 'A@EXAMPLE.COM', phone: '' })?.id).toBe('C-0001')
  })

  it('メール不一致でも電話番号(ハイフン差を吸収)で見つかる', () => {
    expect(findExistingCustomer(customers, { email: 'other@example.com', phone: '09011112222' })?.id).toBe('C-0001')
  })

  it('どちらも一致しなければundefined', () => {
    expect(findExistingCustomer(customers, { email: 'x@example.com', phone: '070-0000-0000' })).toBeUndefined()
  })
})

describe('validateCustomerKeys', () => {
  it('必須項目が揃っていればエラーなし', () => {
    expect(validateCustomerKeys(validSource)).toEqual({})
  })

  it('必須項目が欠けていればフィールドごとにエラーを返す', () => {
    const errors = validateCustomerKeys({ ...validSource, email: '', phone: '' })
    expect(errors.email).toBeTruthy()
    expect(errors.phone).toBeTruthy()
    expect(errors.birthDate).toBeUndefined()
  })

  it('メール形式が不正ならエラーになる', () => {
    expect(validateCustomerKeys({ ...validSource, email: 'not-an-email' }).email).toBeTruthy()
  })
})

describe('buildHealthNotes', () => {
  it('該当項目がなければ「特記なし」', () => {
    expect(buildHealthNotes({})).toBe('特記なし')
  })

  it('該当項目を「、」区切りで並べる', () => {
    expect(buildHealthNotes({ heartDisease: true, diabetes: true })).toBe('心臓疾患、糖尿病')
  })

  it('服薬中は薬剤名を含める', () => {
    expect(buildHealthNotes({ medication: true, medicationName: 'ワーファリン' })).toBe('服薬：ワーファリン')
  })
})

describe('upsertCustomerFromQuestionnaire', () => {
  function makeStore(customers: Customer[]): CustomerStore & { added: Customer[]; updated: Array<{ id: string; data: Partial<Customer> }> } {
    const added: Customer[] = []
    const updated: Array<{ id: string; data: Partial<Customer> }> = []
    return {
      added, updated,
      getCustomers: vi.fn().mockResolvedValue(customers),
      addCustomer: vi.fn(async (data: Customer) => { added.push(data) }),
      updateCustomer: vi.fn(async (id: string, data: Partial<Customer>) => { updated.push({ id, data }) }),
    }
  }

  it('該当する顧客がいなければ新規登録する（C-0001形式で採番）', async () => {
    const store = makeStore([])
    const result = await upsertCustomerFromQuestionnaire(store, validSource, new Date('2026-09-11'))
    expect(result).toEqual({ customerId: 'C-0001', created: true })
    expect(store.added).toHaveLength(1)
    expect(store.added[0].visitCount).toBe(1)
  })

  it('メール一致する顧客がいれば更新する（来店回数を加算）', async () => {
    const existing = fakeCustomer({ id: 'C-0002', email: validSource.email, visitCount: 3 })
    const store = makeStore([existing])
    const result = await upsertCustomerFromQuestionnaire(store, validSource, new Date('2026-09-11'))
    expect(result).toEqual({ customerId: 'C-0002', created: false })
    expect(store.updated).toHaveLength(1)
    expect(store.updated[0].data.visitCount).toBe(4)
  })
})
