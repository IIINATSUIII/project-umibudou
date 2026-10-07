import { describe, it, expect } from 'vitest'
import type { Customer } from '@/types'
import { matchesCustomer } from '../customerSearch'
import {
  C_CARD_FILTER_ALL,
  C_CARD_FILTER_NONE,
  cCardFilterOptions,
  formatLastVisitAgo,
  matchesCCardFilter,
  matchesLastVisitRange,
  sortCustomers,
} from '../customer'

function fakeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'C-0001',
    lastName: '佐藤', firstName: '一郎', lastNameKana: 'サトウ', firstNameKana: 'イチロウ',
    phone: '090-3333-4444', email: 'sato@example.com',
    lastVisit: '2026-06-20', visitCount: 5,
    hasCCard: true, cCardType: 'AOW', totalDives: 150,
    healthNotes: '', guideNotes: '',
    ...overrides,
  } as Customer
}

/** 検証の基準日。相対表記・期間判定をこの日から計算する */
const TODAY = new Date('2026-09-08T00:00:00')

describe('matchesCustomer（表記ゆれの吸収）', () => {
  // 現場では漢字・かな・カナ・半角カナが混在して入力される
  it.each(['佐藤', '佐藤 一郎', '佐藤　一郎', 'さとう', 'サトウ', 'ｻﾄｳ', 'サトウイチロウ'])(
    '%s で氏名にヒットする', (query) => {
      expect(matchesCustomer(fakeCustomer(), query)).toBe(true)
    }
  )

  // ハイフンの有無・位置が揃わないため、数字だけに正規化して突き合わせる
  it.each(['090-3333-4444', '09033334444', '4444', '3333-4444', '０９０３３３３４４４４'])(
    '%s で電話番号にヒットする', (query) => {
      expect(matchesCustomer(fakeCustomer(), query)).toBe(true)
    }
  )

  it('メールアドレス・顧客IDでもヒットする', () => {
    expect(matchesCustomer(fakeCustomer(), 'SATO@example')).toBe(true)
    expect(matchesCustomer(fakeCustomer(), 'c-0001')).toBe(true)
  })

  it('空の検索語は全件を通す', () => {
    expect(matchesCustomer(fakeCustomer(), '   ')).toBe(true)
  })

  it('一致しない語は弾く', () => {
    expect(matchesCustomer(fakeCustomer(), '鈴木')).toBe(false)
  })

  it('カナ未登録の顧客でも落ちない', () => {
    const c = fakeCustomer({ lastNameKana: '', firstNameKana: '', phone: '', email: '' })
    expect(matchesCustomer(c, '佐藤')).toBe(true)
  })
})

describe('matchesLastVisitRange', () => {
  it.each([
    ['within3m', '2026-08-01', true],
    ['within3m', '2026-01-01', false],
    ['within6m', '2026-05-01', true],
    ['within1y', '2025-12-01', true],
    ['over1y', '2024-01-01', true],
    ['over1y', '2026-08-01', false],
  ] as const)('%s / 最終来店%s → %s', (range, lastVisit, expected) => {
    expect(matchesLastVisitRange(fakeCustomer({ lastVisit }), range, TODAY)).toBe(expected)
  })

  it('来店実績なしは「すべて」以外にヒットしない', () => {
    const c = fakeCustomer({ lastVisit: '' })
    expect(matchesLastVisitRange(c, 'all', TODAY)).toBe(true)
    expect(matchesLastVisitRange(c, 'within1y', TODAY)).toBe(false)
    expect(matchesLastVisitRange(c, 'over1y', TODAY)).toBe(false)
  })
})

describe('formatLastVisitAgo', () => {
  it.each([
    ['2026-09-08', '今日'],
    ['2026-09-07', '昨日'],
    ['2026-09-05', '3日前'],
    ['2026-06-20', '2ヶ月前'],
    ['2024-06-20', '2年前'],
    ['', '来店実績なし'],
  ])('%s → %s', (lastVisit, expected) => {
    expect(formatLastVisitAgo(lastVisit, TODAY)).toBe(expected)
  })

  // 基準日と来店日の一方だけをUTC0時として解釈すると、UTCより西の環境で1日ずれる
  it('タイムゾーンに依存しない', () => {
    expect(formatLastVisitAgo('2026-09-08', new Date('2026-09-08T23:30:00'))).toBe('今日')
    expect(formatLastVisitAgo('2026-09-08', new Date('2026-09-08T00:10:00'))).toBe('今日')
  })
})

describe('sortCustomers', () => {
  const list = [
    fakeCustomer({ id: 'A', lastNameKana: 'ヤマモト', firstNameKana: 'ケンタ', lastVisit: '2026-05-05', visitCount: 12 }),
    fakeCustomer({ id: 'B', lastNameKana: 'タナカ', firstNameKana: 'ハナコ', lastVisit: '2026-09-01', visitCount: 1 }),
    fakeCustomer({ id: 'C', lastNameKana: 'サトウ', firstNameKana: 'イチロウ', lastVisit: '', visitCount: 3 }),
  ]

  it('最終来店が新しい順。未設定は最後', () => {
    expect(sortCustomers(list, 'lastVisitDesc').map((c) => c.id)).toEqual(['B', 'A', 'C'])
  })
  it('来店回数が多い順', () => {
    expect(sortCustomers(list, 'visitCountDesc').map((c) => c.id)).toEqual(['A', 'C', 'B'])
  })
  it('かな五十音順', () => {
    expect(sortCustomers(list, 'kanaAsc').map((c) => c.id)).toEqual(['C', 'B', 'A'])
  })
  it('引数の配列を破壊しない', () => {
    sortCustomers(list, 'kanaAsc')
    expect(list.map((c) => c.id)).toEqual(['A', 'B', 'C'])
  })
})

describe('Cカード種別の絞り込み', () => {
  const list = [
    fakeCustomer({ cCardType: 'Rescue Diver' }),
    fakeCustomer({ cCardType: 'OW' }),
    fakeCustomer({ hasCCard: false, cCardType: '' }),
    fakeCustomer({ cCardType: 'AOW' }),
  ]

  // 仕様の並び順を優先し、自由記述の値はその後ろへ回す
  it('選択肢を実データから生成する', () => {
    expect(cCardFilterOptions(list)).toEqual(['OW', 'AOW', 'Rescue Diver'])
  })

  it('すべて／Cカードなし／実値で絞り込める', () => {
    const withCard = fakeCustomer({ cCardType: 'AOW' })
    const without = fakeCustomer({ hasCCard: false, cCardType: '' })
    expect(matchesCCardFilter(withCard, C_CARD_FILTER_ALL)).toBe(true)
    expect(matchesCCardFilter(without, C_CARD_FILTER_NONE)).toBe(true)
    expect(matchesCCardFilter(withCard, C_CARD_FILTER_NONE)).toBe(false)
    expect(matchesCCardFilter(withCard, 'AOW')).toBe(true)
    expect(matchesCCardFilter(withCard, 'OW')).toBe(false)
  })
})
