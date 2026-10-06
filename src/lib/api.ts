/**
 * クライアント側データ取得関数。
 * サーバーの API ルートを fetch し、Google Sheets のデータを操作する。
 */

import type { Reservation, QuestionnaireData, Customer } from '@/types'

// ─── 予約 ─────────────────────────────────────────────────────

/** 予約新規登録の入力。id・登録日時・コース名等の転記はサーバー側で行う。 */
export type NewReservationForm = {
  guestName: string
  guestPhone: string
  guestEmail: string
  diveDate: string
  timeSlot: Reservation['timeSlot']
  courseId: string
  guestCount: number
  channel: Reservation['channel']
  status?: string
  staffId?: string
  divePoint?: string
  staffNote?: string
}

export async function fetchReservations(): Promise<Reservation[]> {
  const res = await fetch('/api/reservations')
  if (!res.ok) throw new Error('Failed to fetch reservations')
  return res.json()
}

export async function createReservation(data: NewReservationForm): Promise<{ id: string }> {
  const res = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create reservation')
  return res.json()
}

/** 予約更新の結果。更新競合（MSG-20）を画面で出し分けるために型で返す。 */
export type PatchReservationResult =
  | { status: 'ok'; updatedAt: string }
  /** 他スタッフが先に更新していた（409）。呼び出し側は最新を再取得して確認を促す */
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string }

/**
 * @param expectedUpdatedAt 画面が読み込んだ時点の最終更新日時。渡すと更新競合を検知する
 */
export async function patchReservation(
  id: string,
  delta: Partial<Reservation>,
  expectedUpdatedAt?: string
): Promise<PatchReservationResult> {
  const res = await fetch('/api/reservations', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...delta, expectedUpdatedAt }),
  })
  const body = await res.json().catch(() => ({}))

  if (res.ok) return { status: 'ok', updatedAt: body.updatedAt ?? '' }
  if (res.status === 409) return { status: 'conflict', message: body.error ?? '' }
  return { status: 'error', message: body.error ?? '更新に失敗しました。' }
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

export async function patchCustomer(id: string, delta: Partial<Customer>): Promise<void> {
  const res = await fetch('/api/customers', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...delta }),
  })
  if (!res.ok) throw new Error('Failed to update customer')
}
