/**
 * 顧客情報のバリデーション（サーバー／クライアント共用）
 * 詳細設計書 4-4「顧客情報編集」・5-3-1 顧客台帳（Customers）の列定義に対応する。
 * サーバーサイド（API Route）を正とし、画面側は同じ関数で即時フィードバックに使う。
 */

import type { Customer } from '@/types'

/** 画面から編集できる列。ここに無いキーは PATCH で無視する（ID・来店回数などは自動更新項目） */
export const EDITABLE_CUSTOMER_FIELDS = [
  'lastName',
  'firstName',
  'lastNameKana',
  'firstNameKana',
  'phone',
  'email',
  'hasCCard',
  'cCardType',
  'totalDives',
  'healthNotes',
  'guideNotes',
] as const

export type EditableCustomerField = (typeof EDITABLE_CUSTOMER_FIELDS)[number]

/** Cカード種別の許容値（詳細設計書 5-3-1 No.17） */
export const C_CARD_TYPES = ['OW', 'AOW', 'Rescue', 'DM', 'Inst'] as const

/** フィールド名 → エラーメッセージ */
export type CustomerFieldErrors = Partial<Record<EditableCustomerField, string>>

const KANA_RE = /^[ァ-ヶー・　\s]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[0-9-]+$/

/** メールアドレスの形式判定（顧客情報編集・顧客自動登録で共用） */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value)
}

const LABEL: Record<EditableCustomerField, string> = {
  lastName: '姓（漢字）',
  firstName: '名（漢字）',
  lastNameKana: '姓（カナ）',
  firstNameKana: '名（カナ）',
  phone: '電話番号',
  email: 'メールアドレス',
  hasCCard: 'Cカードの有無',
  cCardType: 'Cカード種別',
  totalDives: '総ダイビング本数',
  healthNotes: '備考・アレルギー',
  guideNotes: 'ガイドメモ',
}

/** body から編集可能な列だけを取り出す（型・前後空白も整える） */
export function pickEditableFields(body: Record<string, unknown>): Partial<Customer> {
  const delta: Record<string, unknown> = {}
  for (const key of EDITABLE_CUSTOMER_FIELDS) {
    if (!(key in body)) continue
    const value = body[key]
    if (key === 'hasCCard') delta[key] = value === true || value === 'true'
    else if (key === 'totalDives') delta[key] = typeof value === 'number' ? value : Number(value)
    else delta[key] = typeof value === 'string' ? value.trim() : value
  }
  return delta as Partial<Customer>
}

function required(errors: CustomerFieldErrors, field: EditableCustomerField, value: string) {
  if (!value) {
    errors[field] = `${LABEL[field]}は必須です。`
    return false
  }
  return true
}

function maxLength(
  errors: CustomerFieldErrors,
  field: EditableCustomerField,
  value: string,
  max: number
) {
  if (value.length > max) errors[field] = `${LABEL[field]}は${max}文字以内で入力してください。`
}

/**
 * 顧客情報の更新内容を検証する。
 * delta に含まれる列だけを対象にするため、ガイドメモのみの保存でも他項目の欠落で弾かれない。
 *
 * @param delta   更新内容（pickEditableFields 済み）
 * @param current 更新前の顧客（Cカード有無などの相関チェックに使う）
 * @param others  自分以外の全顧客（メールアドレスの重複判定に使う）
 */
export function validateCustomerUpdate(
  delta: Partial<Customer>,
  current: Customer,
  others: Customer[] = []
): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {}
  const merged = { ...current, ...delta }

  for (const field of ['lastName', 'firstName'] as const) {
    if (delta[field] === undefined) continue
    if (required(errors, field, delta[field] as string)) maxLength(errors, field, delta[field] as string, 50)
  }

  for (const field of ['lastNameKana', 'firstNameKana'] as const) {
    const value = delta[field]
    if (value === undefined) continue
    if (!required(errors, field, value)) continue
    if (!KANA_RE.test(value)) errors[field] = `${LABEL[field]}は全角カタカナで入力してください。`
    else maxLength(errors, field, value, 50)
  }

  if (delta.phone !== undefined) {
    const digits = delta.phone.replace(/-/g, '')
    if (required(errors, 'phone', delta.phone)) {
      if (!PHONE_RE.test(delta.phone) || digits.length < 10 || digits.length > 11) {
        errors.phone = '電話番号は数字とハイフンで10〜11桁で入力してください。'
      }
    }
  }

  // メールアドレスは顧客照合のユニークキー（詳細設計書 4-4）。空欄は既存データ互換のため許容する。
  if (delta.email !== undefined && delta.email !== '') {
    if (!isValidEmail(delta.email)) {
      errors.email = 'メールアドレスの形式が正しくありません。'
    } else if (
      others.some((c) => c.id !== current.id && c.email.toLowerCase() === delta.email!.toLowerCase())
    ) {
      errors.email = 'このメールアドレスは他の顧客に登録済みです。'
    }
  }

  if (delta.cCardType !== undefined || delta.hasCCard !== undefined) {
    if (merged.hasCCard) {
      if (!merged.cCardType) errors.cCardType = 'Cカード種別を選択してください。'
      else if (!C_CARD_TYPES.includes(merged.cCardType as (typeof C_CARD_TYPES)[number])) {
        errors.cCardType = `Cカード種別は ${C_CARD_TYPES.join('／')} から選択してください。`
      }
    }
  }

  if (delta.totalDives !== undefined) {
    if (!Number.isFinite(delta.totalDives) || !Number.isInteger(delta.totalDives)) {
      errors.totalDives = '総ダイビング本数は整数で入力してください。'
    } else if (delta.totalDives < 0 || delta.totalDives > 99999) {
      errors.totalDives = '総ダイビング本数は0〜99999の範囲で入力してください。'
    }
  }

  if (delta.healthNotes !== undefined) maxLength(errors, 'healthNotes', delta.healthNotes, 1000)
  if (delta.guideNotes !== undefined) maxLength(errors, 'guideNotes', delta.guideNotes, 1000)

  return errors
}
