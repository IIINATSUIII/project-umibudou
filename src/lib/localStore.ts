/**
 * ローカルファイル永続化ストア（サーバーサイド専用）
 * Google Sheets が未設定の環境で使うフォールバック。
 * プロジェクト直下の data/*.json に保存し、初回アクセス時はモックデータで初期化する。
 * 関数シグネチャは lib/sheets.ts と揃えてあり、API ルートで差し替え可能。
 */

import { promises as fs } from 'fs'
import path from 'path'
import type { Reservation, QuestionnaireData, Customer } from '@/types'
import {
  MOCK_RESERVATIONS,
  MOCK_QUESTIONNAIRES,
  MOCK_CUSTOMERS,
} from './mockData'
import { COURSES, getCourseName, getStaffName, STATUSES } from './masters'

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

const TIME_SLOT_VALUES: readonly Reservation['timeSlot'][] = [
  'morning',
  'afternoon',
  'full',
  'unspecified',
]

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalTextValue(value: unknown): string | undefined {
  const text = textValue(value).trim()
  return text || undefined
}

function normalizeTimeSlot(value: unknown, legacyTime: unknown): Reservation['timeSlot'] {
  if (TIME_SLOT_VALUES.includes(value as Reservation['timeSlot'])) {
    return value as Reservation['timeSlot']
  }

  const time = textValue(legacyTime)
  const hour = Number(time.slice(0, 2))
  if (/^\d{2}:\d{2}$/.test(time) && Number.isInteger(hour)) {
    return hour < 12 ? 'morning' : 'afternoon'
  }
  return 'unspecified'
}

function normalizeChannel(value: unknown): Reservation['channel'] {
  if (value === 'email' || value === 'phone' || value === 'ota') return value
  return 'hp'
}

function normalizeStatus(value: unknown): string {
  const status = textValue(value)
  if (STATUSES.some((item) => item.id === status)) return status
  if (status === 'confirmed') return 'STS-03'
  if (status === 'cancelled') return 'STS-04'
  return 'STS-01'
}

function dateValue(value: Record<string, unknown>): string {
  return textValue(value.diveDate ?? value.date)
}

function normalizeReservations(values: unknown[]): { reservations: Reservation[]; migrated: boolean } {
  const sequenceByDate = new Map<string, number>()
  const rows = values.filter((value): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  ))

  for (const value of rows) {
    const date = dateValue(value)
    const match = textValue(value.id).match(new RegExp(`^R-${date.replace(/-/g, '')}-(\\d+)$`))
    if (match) sequenceByDate.set(date, Math.max(sequenceByDate.get(date) ?? 0, Number(match[1])))
  }

  let migrated = rows.length !== values.length
  const reservations = rows.map((value) => {
    const diveDate = dateValue(value)
    const existingId = textValue(value.id)
    const idPattern = /^R-\d{8}-\d+$/
    let id = existingId
    if (!idPattern.test(existingId)) {
      // 旧IDを変更すると、問診票側の reservationId 参照が切れるため保持する。
      // IDがない行だけは新形式で補完し、新規登録分は reservations.ts で採番する。
      if (!existingId) {
        const sequence = (sequenceByDate.get(diveDate) ?? 0) + 1
        sequenceByDate.set(diveDate, sequence)
        id = `R-${diveDate.replace(/-/g, '')}-${String(sequence).padStart(3, '0')}`
      }
      migrated = true
    }

    const courseId = textValue(value.courseId) || COURSES.find((course) => course.name === textValue(value.course))?.id || ''
    const courseName = textValue(value.courseName) || textValue(value.course) || getCourseName(courseId)
    const questionnaireCompleted = typeof value.questionnaireCompleted === 'boolean'
      ? value.questionnaireCompleted
      : value.questionnaireCompleted === 'TRUE' || value.questionnaireCompleted === 'true' || Boolean(value.questionnaireId)
    const guestCount = typeof value.guestCount === 'number' && Number.isInteger(value.guestCount)
      ? value.guestCount
      : Number(value.guestCount) || 1
    const reservation: Reservation = {
      id,
      createdAt: textValue(value.createdAt) || new Date().toISOString(),
      updatedAt: textValue(value.updatedAt) || textValue(value.createdAt) || new Date().toISOString(),
      customerId: optionalTextValue(value.customerId),
      guestName: textValue(value.guestName).trim(),
      guestPhone: textValue(value.guestPhone ?? value.phone).trim(),
      guestEmail: textValue(value.guestEmail).trim(),
      diveDate,
      timeSlot: normalizeTimeSlot(value.timeSlot, value.time),
      courseId,
      courseName,
      guestCount,
      status: normalizeStatus(value.status),
      staffId: optionalTextValue(value.staffId),
      staffName: textValue(value.staffName) || getStaffName(optionalTextValue(value.staffId)),
      channel: normalizeChannel(value.channel),
      questionnaireToken: optionalTextValue(value.questionnaireToken),
      questionnaireTokenExpiresAt: optionalTextValue(value.questionnaireTokenExpiresAt),
      questionnaireCompleted,
      divePoint: optionalTextValue(value.divePoint),
      staffNote: optionalTextValue(value.staffNote ?? value.notes),
    }

    if (
      !('diveDate' in value) ||
      !('guestPhone' in value) ||
      !('createdAt' in value) ||
      !('questionnaireCompleted' in value)
    ) migrated = true
    return reservation
  })

  return { reservations, migrated }
}

export async function getReservations(): Promise<Reservation[]> {
  const file = path.join(DATA_DIR, 'reservations.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    // ファイルがまだ無い、または壊れている場合だけモックデータで初期化する。
    await writeStore('reservations', MOCK_RESERVATIONS)
    return MOCK_RESERVATIONS
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Reservations store must be an array')
  }

  const { reservations, migrated } = normalizeReservations(parsed)
  // 移行書き込みに失敗した場合はモックデータで上書きせず、呼び出し元へエラーを返す。
  if (migrated) await writeStore('reservations', reservations)
  return reservations
}

export async function addReservation(data: Reservation): Promise<void> {
  const all = await getReservations()
  all.push(data)
  await writeStore('reservations', all)
}

export async function updateReservation(
  id: string,
  data: Partial<Reservation>
): Promise<void> {
  const all = await getReservations()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) throw new Error(`Reservation ${id} not found`)
  all[idx] = { ...all[idx], ...data }
  await writeStore('reservations', all)
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  return readStore<QuestionnaireData>('questionnaires', MOCK_QUESTIONNAIRES)
}

export async function addQuestionnaire(data: QuestionnaireData): Promise<void> {
  const all = await getQuestionnaires()
  all.push(data)
  await writeStore('questionnaires', all)
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
