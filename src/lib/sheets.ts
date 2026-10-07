/**
 * Google Sheets API クライアント（サーバーサイド専用）
 * Next.js の API Route からのみ呼び出すこと。
 */

import { google } from 'googleapis'
import type { Reservation, ReservationInput, QuestionnaireData, Customer } from '@/types'
import { matchesQuestionnaire, nextQuestionnaireId } from './questionnaireUtils'
import { normalizeReservationInput, normalizeReservationPatch } from './reservationNormalization'
import {
  createReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from './reservationQuestionnaireToken'

// ─── 認証・クライアント初期化 ─────────────────────────────────
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID!

// ─── シート名定義 ────────────────────────────────────────────
const SHEET = {
  RESERVATIONS:   '予約',
  QUESTIONNAIRES: '問診票',
  CUSTOMERS:      '顧客台帳',
} as const

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`
}

// ─── ヘッダー行（スプレッドシート初期化用） ─────────────────────
export const HEADERS = {
  RESERVATIONS: [
    'id','createdAt','updatedAt','customerId','guestName','guestPhone','guestEmail',
    'diveDate','time','timeSlot','courseId','courseName','guestCount','status',
    'staffId','staffName','channel','questionnaireId','questionnaireIds',
    'questionnaireToken','questionnaireTokenExpiresAt','questionnaireCompleted','divePoint','staffNote',
  ],
  QUESTIONNAIRES: [
    'id','reservationId','submittedAt',
    'lastName','firstName','lastNameKana','firstNameKana',
    'birthDate','gender','address','phone',
    'emergencyName','emergencyRelation','emergencyPhone',
    'heartDisease','respiratoryDisease','earDisease','epilepsy',
    'diabetes','pregnant','panicDisorder','medication','medicationName','latexAllergy',
    'sleepHours','alcoholLastNight','alcoholToday','condition',
    'flightWithin48h',
    'hasCCard','cCardType','cCardOrg','lastDiveDate','totalDives',
    'agreeRisk','agreeMedical','agreePhoto',
    // 既存データの列位置を維持するため、設計書の追加項目は末尾に追加する。
    'customerId','postalCode','email','highBloodPressure','conditionDetails',
    'consentAt','qrToken','qrExpiresAt','qrUsed','doctorDivingPermit',
    'staffReviewStatus','staffReviewNotes','submissionId',
  ],
  CUSTOMERS: [
    'id','lastName','firstName','lastNameKana','firstNameKana',
    'phone','email','lastVisit','visitCount',
    'hasCCard','cCardType','totalDives','healthNotes','guideNotes',
    // 既存列の位置を保ちながら顧客自動登録に必要な設計項目を追加する。
    'registeredAt','updatedAt','birthDate','gender','postalCode','address',
    'emergencyName','emergencyRelation','emergencyPhone','cCardOrg','lastDiveDate','dmConsent',
    'countedReservationIds','lastDivePeriod',
  ],
}

// ─── 汎用ヘルパー ─────────────────────────────────────────────

/** 行配列 → オブジェクトに変換（ヘッダー行を使って） */
function rowToObj<T>(headers: string[], row: string[]): T {
  const obj: Record<string, unknown> = {}
  headers.forEach((h, i) => {
    const val = row[i] ?? ''
    // boolean 変換
    if (val === 'TRUE' || val === 'true' || val === '済' || val === '完了') obj[h] = true
    else if (val === 'FALSE' || val === 'false' || val === '未') obj[h] = false
    else if (val === '' && ['highBloodPressure', 'qrUsed', 'questionnaireCompleted'].includes(h)) obj[h] = false
    // number 変換
    else if (h === 'guestCount' || h === 'sleepHours' || h === 'totalDives' || h === 'visitCount') {
      obj[h] = val === '' ? 0 : Number(val)
    }
    else obj[h] = val
  })
  return obj as T
}

const RESERVATION_HEADER_ALIASES: Record<string, keyof Reservation> = {
  date: 'diveDate',
  course: 'courseName',
  phone: 'guestPhone',
  notes: 'staffNote',
}

function canonicalHeader(sheetName: string, header: string): string {
  return sheetName === SHEET.RESERVATIONS ? String(RESERVATION_HEADER_ALIASES[header] ?? header) : header
}

function reservationFromRow(headers: string[], row: string[]): Reservation {
  const raw = rowToObj<Record<string, unknown>>(headers, row)
  // New canonical columns can coexist with populated legacy columns. Keep the
  // legacy value when the appended canonical cell is still blank.
  for (const [legacy, canonical] of Object.entries(RESERVATION_HEADER_ALIASES)) {
    const canonicalValue = raw[canonical]
    const legacyValue = raw[legacy]
    if (
      (canonicalValue === undefined || canonicalValue === null || String(canonicalValue).trim() === '') &&
      legacyValue !== undefined && legacyValue !== null && String(legacyValue).trim() !== ''
    ) raw[canonical] = legacyValue
  }
  return normalizeReservationInput(raw as ReservationInput)
}

/** オブジェクト → 実シートの列順に変換。予約の旧列名はcanonical fieldへ対応させる。 */
function objToRow(sheetName: string, headers: string[], obj: Record<string, unknown>): string[] {
  return headers.map((header) => {
    const key = canonicalHeader(sheetName, header)
    const v = obj[key] !== undefined ? obj[key] : obj[header]
    if (v === undefined || v === null) return ''
    return String(v)
  })
}

interface SheetTable {
  headers: string[]
  rows: string[][]
}

/** 実ヘッダー行とデータ行を取得し、固定列位置に依存しない。 */
async function getSheetTable(sheetName: string, timeoutMs?: number): Promise<SheetTable> {
  const sheets = getSheetsClient()
  const params = {
    spreadsheetId: SPREADSHEET_ID,
    range: `${quoteSheetName(sheetName)}!A1:AZ`,
  }
  const res = timeoutMs
    ? await sheets.spreadsheets.values.get(params, { timeout: timeoutMs })
    : await sheets.spreadsheets.values.get(params)
  const values = (res.data.values ?? []) as string[][]
  return { headers: values[0] ?? [], rows: values.slice(1) }
}

/** 指定シートをヘッダー行込みで取得する（外部取込用） */
export async function getSheetValues(
  sheetName: string,
  spreadsheetId: string = SPREADSHEET_ID
): Promise<string[][]> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:AZ`,
  })
  return (res.data.values ?? []) as string[][]
}

/** オブジェクトを実ヘッダー順で末尾に追加する。 */
async function appendObject(sheetName: string, data: Record<string, unknown>, timeoutMs?: number): Promise<void> {
  const { headers } = await getSheetTable(sheetName, timeoutMs)
  if (!headers.includes('id')) throw new Error(`Header row is missing in ${sheetName}`)

  const availableFields = new Set(headers.map((header) => canonicalHeader(sheetName, header)))
  const missingFields = Object.entries(data)
    .filter(([key, value]) => value !== undefined && value !== null && value !== '' && !availableFields.has(key))
    .map(([key]) => key)
  if (missingFields.length > 0) {
    throw new Error(`Missing columns in ${sheetName}: ${missingFields.join(', ')}. Run sheet setup to append them.`)
  }

  const sheets = getSheetsClient()
  const params = {
    spreadsheetId: SPREADSHEET_ID,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [objToRow(sheetName, headers, data)] },
  }
  if (timeoutMs) await sheets.spreadsheets.values.append(params, { timeout: timeoutMs })
  else await sheets.spreadsheets.values.append(params)
}

function columnName(index: number): string {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

/** IDで行を検索し、指定されたフィールドのセルだけを更新する。 */
async function updateRowById(
  sheetName: string,
  id: string,
  data: Record<string, unknown>,
  timeoutMs?: number,
): Promise<void> {
  const sheets = getSheetsClient()
  const { headers, rows } = await getSheetTable(sheetName, timeoutMs)
  const idColumn = headers.indexOf('id')
  if (idColumn === -1) throw new Error(`ID header is missing in ${sheetName}`)
  const rowIndex = rows.findIndex((row) => row[idColumn] === id)
  if (rowIndex === -1) throw new Error(`ID "${id}" not found in ${sheetName}`)

  const availableFields = new Set(headers.map((header) => canonicalHeader(sheetName, header)))
  const missingFields = Object.entries(data)
    .filter(([key, value]) => value !== undefined && value !== null && value !== '' && !availableFields.has(key))
    .map(([key]) => key)
  if (missingFields.length > 0) {
    throw new Error(`Missing columns in ${sheetName}: ${missingFields.join(', ')}. Run sheet setup to append them.`)
  }

  const sheetRowIndex = rowIndex + 2 // 1-indexed + ヘッダー行
  const updates = headers.flatMap((header, index) => {
    const key = canonicalHeader(sheetName, header)
    if (!Object.prototype.hasOwnProperty.call(data, key) && !Object.prototype.hasOwnProperty.call(data, header)) {
      return []
    }
    const value = data[key] !== undefined ? data[key] : data[header]
    return [{
      range: `${quoteSheetName(sheetName)}!${columnName(index)}${sheetRowIndex}`,
      values: [[value === undefined || value === null ? '' : String(value)]],
    }]
  })
  if (updates.length === 0) return

  const params = {
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: updates },
  }
  if (timeoutMs) await sheets.spreadsheets.values.batchUpdate(params, { timeout: timeoutMs })
  else await sheets.spreadsheets.values.batchUpdate(params)
}

export type SheetsProjectionEntity = 'customer' | 'reservation' | 'questionnaire'

export function isSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SPREADSHEET_ID,
  )
}

/**
 * ID-based, retry-safe projection upsert used by the PostgreSQL outbox worker.
 * It fills absent optional fields with empty cells so a retry can also clear old values.
 */
export async function upsertSheetProjection(
  entityType: SheetsProjectionEntity,
  payload: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const config = {
    customer: { sheetName: SHEET.CUSTOMERS, headers: HEADERS.CUSTOMERS },
    reservation: { sheetName: SHEET.RESERVATIONS, headers: HEADERS.RESERVATIONS },
    questionnaire: { sheetName: SHEET.QUESTIONNAIRES, headers: HEADERS.QUESTIONNAIRES },
  }[entityType]
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (!id) throw new Error('Projection payload is missing an ID')

  const projection: Record<string, unknown> = { id }
  for (const header of config.headers) {
    const key = canonicalHeader(config.sheetName, header)
    projection[key] = payload[key] === undefined || payload[key] === null ? '' : payload[key]
  }

  const { headers, rows } = await getSheetTable(config.sheetName, options.timeoutMs)
  const idColumn = headers.indexOf('id')
  if (idColumn === -1) throw new Error(`ID header is missing in ${config.sheetName}`)
  const matches = rows.filter((row) => row[idColumn] === id)
  if (matches.length > 1) throw new Error(`Duplicate ID rows exist in ${config.sheetName}`)
  if (matches.length === 1) {
    await updateRowById(config.sheetName, id, projection, options.timeoutMs)
  } else {
    await appendObject(config.sheetName, projection, options.timeoutMs)
  }
}

// ─── 予約 ─────────────────────────────────────────────────────

export async function getReservations(): Promise<Reservation[]> {
  const { headers, rows } = await getSheetTable(SHEET.RESERVATIONS)
  return rows.filter((row) => row.some((cell) => cell !== '')).map((row) => reservationFromRow(headers, row))
}

export async function addReservation(data: ReservationInput): Promise<Reservation> {
  const normalized = normalizeReservationInput(data)
  const reservation = {
    ...normalized,
    questionnaireToken: normalized.questionnaireToken ?? createReservationQuestionnaireToken(),
    questionnaireTokenExpiresAt: normalized.questionnaireTokenExpiresAt ??
      questionnaireTokenExpiryForDiveDate(normalized.diveDate),
  }
  await appendObject(SHEET.RESERVATIONS, reservation as unknown as Record<string, unknown>)
  return reservation
}

export async function updateReservation(id: string, data: ReservationInput): Promise<void> {
  const all = await getReservations()
  const existing = all.find((r) => r.id === id)
  if (!existing) throw new Error(`Reservation ${id} not found`)
  const patch = normalizeReservationPatch(data)
  const updated = { ...existing, ...patch }
  if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
    updated.questionnaireTokenExpiresAt = questionnaireTokenExpiryForDiveDate(updated.diveDate)
  }
  const persistedPatch = { ...patch }
  if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
    persistedPatch.questionnaireTokenExpiresAt = updated.questionnaireTokenExpiresAt
  }
  await updateRowById(SHEET.RESERVATIONS, id, persistedPatch as Record<string, unknown>)
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  const { headers, rows } = await getSheetTable(SHEET.QUESTIONNAIRES)
  return rows.filter((row) => row.some((cell) => cell !== '')).map((row) => rowToObj<QuestionnaireData>(headers, row))
}

let questionnaireWriteQueue: Promise<void> = Promise.resolve()

export async function addQuestionnaire(
  data: Omit<QuestionnaireData, 'id'>
): Promise<QuestionnaireData> {
  let saved: QuestionnaireData | undefined
  const write = async () => {
    const all = await getQuestionnaires()
    saved = { ...data, id: nextQuestionnaireId(all) }
    await appendObject(SHEET.QUESTIONNAIRES, saved as unknown as Record<string, unknown>)
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
  const existing = all.find((questionnaire) => questionnaire.id === id)
  if (!existing) throw new Error(`Questionnaire ${id} not found`)
  const updated = { ...existing, ...data }
  await updateRowById(SHEET.QUESTIONNAIRES, id, data as Record<string, unknown>)
  return updated
}

// ─── 顧客台帳 ─────────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  const { headers, rows } = await getSheetTable(SHEET.CUSTOMERS)
  return rows.filter((row) => row.some((cell) => cell !== '')).map((row) => rowToObj<Customer>(headers, row))
}

export async function addCustomer(data: Customer): Promise<void> {
  await appendObject(SHEET.CUSTOMERS, data as unknown as Record<string, unknown>)
}

export async function updateCustomer(id: string, data: Partial<Customer>): Promise<void> {
  const all = await getCustomers()
  const existing = all.find((c) => c.id === id)
  if (!existing) throw new Error(`Customer ${id} not found`)
  await updateRowById(SHEET.CUSTOMERS, id, data as Record<string, unknown>)
}

// ─── スプレッドシート初期化（初回セットアップ用） ────────────────
/**
 * 不足ヘッダーだけを既存データの右端へ追加する。既存ヘッダーと既存行は変更しない。
 * 初回セットアップ時またはスキーマ更新後に実行（/api/setup エンドポイント経由）。
 */
export async function initializeSheets(): Promise<void> {
  for (const [sheetName, headers] of [
    [SHEET.RESERVATIONS, HEADERS.RESERVATIONS],
    [SHEET.QUESTIONNAIRES, HEADERS.QUESTIONNAIRES],
    [SHEET.CUSTOMERS, HEADERS.CUSTOMERS],
  ] as const) {
    const table = await getSheetTable(sheetName)
    const existingWidth = table.rows.reduce((width, row) => Math.max(width, row.length), table.headers.length)
    const missingHeaders = headers.filter((header) => !table.headers.includes(header))
    if (missingHeaders.length === 0) continue

    const start = columnName(existingWidth)
    const end = columnName(existingWidth + missingHeaders.length - 1)
    const sheets = getSheetsClient()
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${quoteSheetName(sheetName)}!${start}1:${end}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [missingHeaders as string[]] },
    })
  }
}
