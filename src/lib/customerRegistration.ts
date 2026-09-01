/**
 * 顧客自動登録（サーバーサイド専用のロジック）
 * 詳細設計書 4-4「顧客自動登録」／5-3-1 顧客台帳（Customers）に対応する。
 *
 * 問診票の送信が正常に完了したときに、メールアドレスをユニークキーとして
 * 顧客台帳を新規登録／更新し、採番した顧客IDを問診回答へ書き戻す。
 * ストアに依存しない純粋関数として切り出し、API ルートから呼び出す。
 */

import type { Customer, QuestionnaireData } from '@/types'
import { isValidEmail } from './customerValidation'

/** 顧客自動登録に使う入力（問診票の送信内容のうち必要な列だけ） */
export type CustomerSource = Pick<
  QuestionnaireData,
  | 'lastName' | 'firstName' | 'lastNameKana' | 'firstNameKana'
  | 'birthDate' | 'gender' | 'address' | 'phone' | 'email'
  | 'emergencyName' | 'emergencyRelation' | 'emergencyPhone'
  | 'hasCCard' | 'cCardType' | 'cCardOrg' | 'lastDiveDate' | 'totalDives'
  | 'heartDisease' | 'respiratoryDisease' | 'earDisease' | 'epilepsy'
  | 'diabetes' | 'medication' | 'medicationName' | 'latexAllergy'
>

/**
 * 顧客台帳の行を生成するために欠けてはいけない列（詳細設計書 4-4 末尾）。
 * SC-05 側でも必須にしているため、ここで欠落していれば行を作らずエラーにする。
 * 緊急連絡先の「続柄」は SC-05 で任意入力のため対象外。
 */
export const CUSTOMER_KEY_FIELDS = [
  'email',
  'phone',
  'birthDate',
  'emergencyName',
  'emergencyPhone',
] as const

export type CustomerKeyField = (typeof CUSTOMER_KEY_FIELDS)[number]

const KEY_LABEL: Record<CustomerKeyField, string> = {
  email: 'メールアドレス',
  phone: '電話番号',
  birthDate: '生年月日',
  emergencyName: '緊急連絡先氏名',
  emergencyPhone: '緊急連絡先電話番号',
}

/** 顧客ID の書式："C-" ＋ 連番4桁（詳細設計書 5-3-1 No.1） */
const CUSTOMER_ID_RE = /^C-?(\d{1,4})$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 電話番号の照合用に数字だけを取り出す（ハイフン有無の差を吸収する） */
export function normalizePhone(value: string): string {
  return text(value).replace(/\D/g, '')
}

/**
 * 顧客台帳の行を作れるだけの必須項目が揃っているか検証する。
 * @returns 列名 → エラーメッセージ。空オブジェクトなら登録可。
 */
export function validateCustomerKeys(
  source: Partial<CustomerSource>
): Partial<Record<CustomerKeyField, string>> {
  const errors: Partial<Record<CustomerKeyField, string>> = {}

  for (const field of CUSTOMER_KEY_FIELDS) {
    if (!text(source[field])) errors[field] = `${KEY_LABEL[field]}は必須です。`
  }
  if (!errors.email && !isValidEmail(text(source.email))) {
    errors.email = 'メールアドレスの形式が正しくありません。'
  }

  return errors
}

/**
 * 次に採番する顧客ID を返す（"C-0001" 形式）。
 * 旧実装のタイムスタンプ ID（C1700000000000）は連番の対象外として無視する。
 */
export function nextCustomerId(customers: Customer[]): string {
  let max = 0
  for (const c of customers) {
    const m = CUSTOMER_ID_RE.exec(text(c.id))
    if (m) max = Math.max(max, Number(m[1]))
  }

  const used = new Set(customers.map((c) => c.id))
  let seq = max + 1
  let id = format(seq)
  while (used.has(id)) id = format(++seq)
  return id

  function format(n: number): string {
    return `C-${String(n).padStart(4, '0')}`
  }
}

/**
 * 既存顧客を探す。
 * メールアドレス（ユニークキー）で照合し、見つからなければ電話番号（副キー）で照合する。
 */
export function findExistingCustomer(
  customers: Customer[],
  source: Pick<CustomerSource, 'email' | 'phone'>
): Customer | undefined {
  const email = text(source.email).toLowerCase()
  if (email) {
    const hit = customers.find((c) => text(c.email).toLowerCase() === email)
    if (hit) return hit
  }

  const phone = normalizePhone(source.phone)
  if (phone) return customers.find((c) => normalizePhone(c.phone) === phone)

  return undefined
}

/** 問診票の健康状態から、顧客台帳の「備考・アレルギー」に載せる要約を作る */
export function buildHealthNotes(source: Partial<CustomerSource>): string {
  return (
    [
      source.heartDisease       && '心臓疾患',
      source.respiratoryDisease && '呼吸器疾患',
      source.earDisease         && '耳の疾患',
      source.epilepsy           && 'てんかん',
      source.diabetes           && '糖尿病',
      source.medication         && `服薬：${text(source.medicationName) || '薬剤名未記入'}`,
      source.latexAllergy       && 'ラテックスアレルギー',
    ]
      .filter(Boolean)
      .join('、') || '特記なし'
  )
}

/** 新規顧客の行を組み立てる（詳細設計書 4-4「該当がない場合」） */
export function buildNewCustomer(
  source: CustomerSource,
  id: string,
  now: Date
): Customer {
  const timestamp = now.toISOString()
  return {
    id,
    lastName: text(source.lastName),
    firstName: text(source.firstName),
    lastNameKana: text(source.lastNameKana),
    firstNameKana: text(source.firstNameKana),
    phone: text(source.phone),
    email: text(source.email),
    lastVisit: timestamp.slice(0, 10),
    visitCount: 1,
    hasCCard: !!source.hasCCard,
    cCardType: text(source.cCardType),
    totalDives: Number(source.totalDives) || 0,
    healthNotes: buildHealthNotes(source),
    guideNotes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    birthDate: text(source.birthDate),
    gender: source.gender,
    address: text(source.address),
    emergencyName: text(source.emergencyName),
    emergencyRelation: text(source.emergencyRelation),
    emergencyPhone: text(source.emergencyPhone),
    cCardOrg: text(source.cCardOrg),
    lastDiveDate: text(source.lastDiveDate),
  }
}

/**
 * 既存顧客の更新内容を組み立てる（詳細設計書 4-4「該当がある場合」）。
 * 来店回数を加算し、最終ダイブ日・Cカード種別・認定団体・総ダイビング本数を最新の問診内容で更新する。
 * それ以外の列はスタッフが手で直した内容を尊重し、台帳側が空のときだけ問診票の値で補完する。
 */
export function buildCustomerUpdate(
  source: CustomerSource,
  existing: Customer,
  now: Date
): Partial<Customer> {
  const timestamp = now.toISOString()
  const delta: Partial<Customer> = {
    visitCount: (Number(existing.visitCount) || 0) + 1,
    lastVisit: timestamp.slice(0, 10),
    hasCCard: !!source.hasCCard,
    cCardType: text(source.cCardType),
    cCardOrg: text(source.cCardOrg),
    totalDives: Number(source.totalDives) || 0,
    updatedAt: timestamp,
  }
  if (text(source.lastDiveDate)) delta.lastDiveDate = text(source.lastDiveDate)

  // 電話番号で照合した場合などに備え、台帳側が未設定の列だけ問診票の値で埋める
  const fillable = [
    'lastNameKana', 'firstNameKana', 'email', 'birthDate', 'address',
    'emergencyName', 'emergencyRelation', 'emergencyPhone',
  ] as const
  for (const field of fillable) {
    if (!text(existing[field]) && text(source[field])) delta[field] = text(source[field])
  }
  if (!existing.gender && source.gender) delta.gender = source.gender

  return delta
}

/** 顧客自動登録が読み書きするストア（lib/sheets・lib/localStore の部分集合） */
export interface CustomerStore {
  getCustomers(): Promise<Customer[]>
  addCustomer(data: Customer): Promise<void>
  updateCustomer(id: string, data: Partial<Customer>): Promise<void>
}

export interface CustomerRegistrationResult {
  customerId: string
  /** true なら新規登録、false なら既存顧客の更新 */
  created: boolean
}

/**
 * 問診票の内容で顧客台帳を新規登録／更新する。
 * 呼び出し側は事前に validateCustomerKeys で必須列を検証しておくこと
 * （必須列が NULL の行を作らないため）。
 */
export async function upsertCustomerFromQuestionnaire(
  store: CustomerStore,
  source: CustomerSource,
  now: Date = new Date()
): Promise<CustomerRegistrationResult> {
  const customers = await store.getCustomers()
  const existing = findExistingCustomer(customers, source)

  if (existing) {
    await store.updateCustomer(existing.id, buildCustomerUpdate(source, existing, now))
    return { customerId: existing.id, created: false }
  }

  const customer = buildNewCustomer(source, nextCustomerId(customers), now)
  await store.addCustomer(customer)
  return { customerId: customer.id, created: true }
}
