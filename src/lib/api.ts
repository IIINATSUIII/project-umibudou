/**
 * クライアント側データ取得関数。
 * サーバーの API ルートを fetch し、Google Sheets のデータを操作する。
 */

import type { CustomerFieldErrors } from './customerValidation'
import type {
  RosterEntry,
  Reservation,
  ReservationInput,
  QuestionnaireData,
  QuestionnaireFormData,
  QuestionnaireSummary,
  Customer,
} from '@/types'

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

export class ApiRequestError extends Error {
  readonly status: number
  readonly fields?: Record<string, string>

  constructor(
    message: string,
    status: number,
    fields?: Record<string, string>
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.fields = fields
  }
}

export async function fetchReservations(): Promise<Reservation[]> {
  const res = await fetch('/api/reservations')
  if (!res.ok) throw new Error('Failed to fetch reservations')
  return res.json()
}

export async function createReservation(
  data: ReservationInput | NewReservationForm
): Promise<{ id?: string }> {
  const res = await fetch('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiRequestError(
      body?.message ?? '予約の登録に失敗しました。入力内容を確認してください',
      res.status,
      body?.fields
    )
  }
  return body
}

export async function patchReservation(
  id: string,
  delta: Partial<Reservation>,
  expectedUpdatedAt: string
): Promise<string> {
  const res = await fetch('/api/reservations', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...delta, expectedUpdatedAt }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new ApiRequestError(body.error || '保存に失敗しました', res.status)
  if (typeof body.updatedAt !== 'string')
    throw new Error('更新結果を確認できませんでした')
  return body.updatedAt
}

// ─── 問診票 ───────────────────────────────────────────────────

export function fetchQuestionnaires(): Promise<QuestionnaireData[]>
export function fetchQuestionnaires(
  query: string
): Promise<QuestionnaireSummary[]>
export async function fetchQuestionnaires(
  query = ''
): Promise<QuestionnaireData[] | QuestionnaireSummary[]> {
  const res = await fetch(`/api/questionnaires?q=${encodeURIComponent(query)}`)
  if (res.status === 410) throw new Error('QR_EXPIRED')
  if (!res.ok) throw new Error('Failed to fetch questionnaires')
  return res.json()
}

export async function fetchQuestionnaireById(
  id: string
): Promise<QuestionnaireData> {
  const res = await fetch(`/api/questionnaires?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error('Failed to fetch questionnaire')
  return res.json()
}

export async function submitQuestionnaire(
  data: QuestionnaireFormData & { reservationId: string }
): Promise<void> {
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

/** 顧客情報更新の結果。 */
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

  if (res.ok && body.customer?.id === id)
    return {
      status: 'ok',
      message: body.message ?? '',
      customer: body.customer,
    }
  if (res.status === 409 && body.customer?.id === id) {
    return {
      status: 'conflict',
      message: body.message ?? '',
      customer: body.customer,
    }
  }
  if (body?.error === 'VALIDATION_ERROR') {
    return {
      status: 'invalid',
      message: body.message ?? '',
      fields: body.fields ?? {},
    }
  }
  return { status: 'error', message: body?.message ?? '保存に失敗しました。' }
}

export async function fetchRoster(): Promise<RosterEntry[]> {
  const r = await fetch('/api/roster')
  if (!r.ok) throw new Error('名簿を取得できません')
  return r.json()
}
export async function addRoster(data: {
  questionnaireId: string
  qrToken?: string
  method: RosterEntry['checkInMethod']
}) {
  const r = await fetch('/api/roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const b = await r.json()
  if (!r.ok) throw new Error(b.error || '受付できません')
  return b
}
export async function issueQuestionnaireUrl(id: string, reissue = false) {
  const r = await fetch('/api/reservations/questionnaire-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, reissue }),
  })
  const b = await r.json()
  if (!r.ok) throw new Error(b.error || '発行できません')
  return b as {
    questionnaireToken: string
    questionnaireTokenExpiresAt: string
  }
}
