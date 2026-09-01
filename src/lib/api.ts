/**
 * クライアント側データ取得関数。
 * サーバーの API ルートを fetch し、Google Sheets のデータを操作する。
 */

import type { Reservation, QuestionnaireData, Customer } from '@/types'
import type { CustomerFieldErrors } from './customerValidation'

// ─── 予約 ─────────────────────────────────────────────────────

export async function fetchReservations(): Promise<Reservation[]> {
  const res = await fetch('/api/reservations')
  if (!res.ok) throw new Error('Failed to fetch reservations')
  return res.json()
}

export async function createReservation(data: Reservation): Promise<void> {
  const res = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create reservation')
}

export async function patchReservation(id: string, delta: Partial<Reservation>): Promise<void> {
  const res = await fetch('/api/reservations', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...delta }),
  })
  if (!res.ok) throw new Error('Failed to update reservation')
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function fetchQuestionnaires(): Promise<QuestionnaireData[]> {
  const res = await fetch('/api/questionnaires')
  if (!res.ok) throw new Error('Failed to fetch questionnaires')
  return res.json()
}

export async function submitQuestionnaire(data: QuestionnaireData): Promise<void> {
  const res = await fetch('/api/questionnaires', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to submit questionnaire')
}

// ─── 顧客台帳 ─────────────────────────────────────────────────

export async function fetchCustomers(): Promise<Customer[]> {
  const res = await fetch('/api/customers')
  if (!res.ok) throw new Error('Failed to fetch customers')
  return res.json()
}

export async function createCustomer(data: Customer): Promise<void> {
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create customer')
}

/** 顧客情報更新の結果。バリデーションエラー・更新競合を画面で出し分けるために型で返す。 */
export type PatchCustomerResult =
  | { status: 'ok'; message: string; customer: Customer }
  /** サーバーサイドバリデーションで弾かれた（フィールド名 → メッセージ） */
  | { status: 'invalid'; message: string; fields: CustomerFieldErrors }
  /** 他スタッフが先に更新していた（MSG-20）。customer は最新の内容 */
  | { status: 'conflict'; message: string; customer: Customer }
  | { status: 'error'; message: string }

export interface PatchCustomerOptions {
  /** 画面が読み込んだ時点の最終更新日時。渡すと更新競合を検知する */
  expectedUpdatedAt?: string
  /** true で競合を無視して上書き（原則後勝ち） */
  force?: boolean
}

export async function patchCustomer(
  id: string,
  delta: Partial<Customer>,
  options: PatchCustomerOptions = {}
): Promise<PatchCustomerResult> {
  const res = await fetch('/api/customers', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...delta, ...options }),
  })
  const body = await res.json().catch(() => ({}))

  if (res.ok) return { status: 'ok', message: body.message ?? '', customer: body.customer }
  if (res.status === 409) {
    return { status: 'conflict', message: body.message ?? '', customer: body.customer }
  }
  if (body?.error === 'VALIDATION_ERROR') {
    return { status: 'invalid', message: body.message ?? '', fields: body.fields ?? {} }
  }
  return { status: 'error', message: body?.message ?? '保存に失敗しました。' }
}
