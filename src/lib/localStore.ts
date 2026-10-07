/**
 * ローカルファイル永続化ストア（サーバーサイド専用）
 * Google Sheets が未設定の環境で使うフォールバック。
 * プロジェクト直下の data/*.json に保存し、初回アクセス時はモックデータで初期化する。
 * 関数シグネチャは lib/sheets.ts と揃えてあり、API ルートで差し替え可能。
 */

import { promises as fs } from 'fs'
import path from 'path'
import type { Reservation, ReservationInput, QuestionnaireData, Customer } from '@/types'
import { matchesQuestionnaire, nextQuestionnaireId } from './questionnaireUtils'
import { normalizeReservationInput, normalizeReservationPatch } from './reservationNormalization'
import {
  createReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from './reservationQuestionnaireToken'
import {
  MOCK_RESERVATIONS,
  MOCK_QUESTIONNAIRES,
  MOCK_CUSTOMERS,
} from './mockData'

const DATA_DIR = path.join(process.cwd(), 'data')

async function readStore<T>(name: string, seed: T[]): Promise<T[]> {
  const file = path.join(DATA_DIR, `${name}.json`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T[]
  } catch {
    // ファイルがまだ無い → モックデータで初期化
    await writeStore(name, seed)
    return seed
  }
}

async function writeStore<T>(name: string, data: T[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(
    path.join(DATA_DIR, `${name}.json`),
    JSON.stringify(data, null, 2),
    'utf8'
  )
}

// ─── 予約 ─────────────────────────────────────────────────────

export async function getReservations(): Promise<Reservation[]> {
  const all = await readStore<ReservationInput>('reservations', MOCK_RESERVATIONS)
  return all.map(normalizeReservationInput)
}

export async function addReservation(data: ReservationInput): Promise<Reservation> {
  const all = await getReservations()
  const normalized = normalizeReservationInput(data)
  const reservation = {
    ...normalized,
    questionnaireToken: normalized.questionnaireToken ?? createReservationQuestionnaireToken(),
    questionnaireTokenExpiresAt: normalized.questionnaireTokenExpiresAt ??
      questionnaireTokenExpiryForDiveDate(normalized.diveDate),
  }
  all.push(reservation)
  await writeStore('reservations', all)
  return reservation
}

export async function updateReservation(
  id: string,
  data: ReservationInput
): Promise<void> {
  const all = await getReservations()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) throw new Error(`Reservation ${id} not found`)
  const patch = normalizeReservationPatch(data)
  const updated = { ...all[idx], ...patch }
  if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
    updated.questionnaireTokenExpiresAt = questionnaireTokenExpiryForDiveDate(updated.diveDate)
  }
  all[idx] = updated
  await writeStore('reservations', all)
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  return readStore<QuestionnaireData>('questionnaires', MOCK_QUESTIONNAIRES)
}

let questionnaireWriteQueue: Promise<void> = Promise.resolve()

export async function addQuestionnaire(
  data: Omit<QuestionnaireData, 'id'>
): Promise<QuestionnaireData> {
  let saved: QuestionnaireData | undefined
  const write = async () => {
    const all = await getQuestionnaires()
    saved = { ...data, id: nextQuestionnaireId(all) }
    all.push(saved)
    await writeStore('questionnaires', all)
  }
  const pending = questionnaireWriteQueue.then(write, write)
  questionnaireWriteQueue = pending.then(() => undefined, () => undefined)
  await pending
  if (!saved) throw new Error('Failed to create questionnaire')
  return saved
}

export async function searchQuestionnaires(query: string): Promise<QuestionnaireData[]> {
  const all = await getQuestionnaires()
  return all.filter((questionnaire) => matchesQuestionnaire(questionnaire, query))
}

export async function getQuestionnaireById(id: string): Promise<QuestionnaireData | undefined> {
  const all = await getQuestionnaires()
  return all.find((questionnaire) => questionnaire.id === id)
}

export async function updateQuestionnaire(
  id: string,
  data: Partial<QuestionnaireData>
): Promise<QuestionnaireData> {
  const all = await getQuestionnaires()
  const idx = all.findIndex((questionnaire) => questionnaire.id === id)
  if (idx === -1) throw new Error(`Questionnaire ${id} not found`)
  all[idx] = { ...all[idx], ...data }
  await writeStore('questionnaires', all)
  return all[idx]
}

// ─── 顧客台帳 ─────────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  return readStore<Customer>('customers', MOCK_CUSTOMERS)
}

export async function addCustomer(data: Customer): Promise<void> {
  const all = await getCustomers()
  all.push(data)
  await writeStore('customers', all)
}

export async function updateCustomer(
  id: string,
  data: Partial<Customer>
): Promise<void> {
  const all = await getCustomers()
  const idx = all.findIndex((c) => c.id === id)
  if (idx === -1) throw new Error(`Customer ${id} not found`)
  all[idx] = { ...all[idx], ...data }
  await writeStore('customers', all)
}
