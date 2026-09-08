/**
 * クライアント側データ取得関数。
 * サーバーの API ルートを fetch し、Google Sheets のデータを操作する。
 */

import type { Reservation, QuestionnaireData, Customer, RosterEntry } from '@/types'

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

export async function fetchRoster(): Promise<RosterEntry[]> {
  const res = await fetch('/api/roster')
  if (!res.ok) throw new Error('Failed to fetch roster')
  return res.json()
}

export async function addRoster(questionnaireId: string, method: RosterEntry['checkInMethod'], qrToken?: string): Promise<RosterEntry> {
  const res = await fetch('/api/roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionnaireId, method, qrToken }),
  })
  if (!res.ok) throw new Error('Failed to add roster entry')
  return (await res.json()).entry
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
