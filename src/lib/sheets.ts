/**
 * Google Sheets API クライアント（サーバーサイド専用）
 * Next.js の API Route からのみ呼び出すこと。
 */

import { QUESTIONNAIRE_COLUMNS, readQuestionnaireTable, requireCanonicalHeaders, questionnaireRow } from './questionnaireSchema'
import { google } from 'googleapis'
import type { Reservation, QuestionnaireData, Customer } from '@/types'
import { matchesQuestionnaire, nextQuestionnaireId } from './questionnaireUtils'

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
  QUESTIONNAIRES: process.env.GOOGLE_QUESTIONNAIRE_SHEET || '問診票',
  CUSTOMERS:      '顧客台帳',
} as const

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`
}

// ─── ヘッダー行（スプレッドシート初期化用） ─────────────────────
export const HEADERS = {
  RESERVATIONS:   ['id','date','time','course','guestName','guestCount','phone','channel','status','questionnaireId','notes','questionnaireToken','questionnaireExpiresAt'],
  QUESTIONNAIRES: [...QUESTIONNAIRE_COLUMNS],
  CUSTOMERS: [
    'id','lastName','firstName','lastNameKana','firstNameKana',
    'phone','email','lastVisit','visitCount',
    'hasCCard','cCardType','totalDives','healthNotes','guideNotes',
    // 既存列の位置を保ちながら顧客自動登録に必要な設計項目を追加する。
    'registeredAt','updatedAt','birthDate','gender','postalCode','address',
    'emergencyName','emergencyRelation','emergencyPhone','cCardOrg','lastDiveDate','dmConsent',
    'countedQuestionnaireIds',
  ],
}

// ─── 汎用ヘルパー ─────────────────────────────────────────────

/** 行配列 → オブジェクトに変換（ヘッダー行を使って） */
function rowToObj<T>(headers: string[], row: string[]): T {
  const obj: Record<string, unknown> = {}
  headers.forEach((h, i) => {
    const val = row[i] ?? ''
    // boolean 変換
    if (val === 'TRUE' || val === 'true') obj[h] = true
    else if (val === 'FALSE' || val === 'false') obj[h] = false
    else if (val === '' && ['highBloodPressure', 'qrUsed'].includes(h)) obj[h] = false
    // number 変換
    else if (h === 'guestCount' || h === 'sleepHours' || h === 'totalDives' || h === 'visitCount') {
      obj[h] = val === '' ? (h === 'totalDives' || h === 'sleepHours' ? null : 0) : Number(val)
    }
    else obj[h] = val
  })
  return obj as T
}

/** オブジェクト → 行配列に変換 */
function objToRow(headers: string[], obj: Record<string, unknown>): string[] {
  return headers.map((h) => {
    const v = obj[h]
    if (v === undefined || v === null) return ''
    return String(v)
  })
}

/** シートの全データを取得（ヘッダー行を除く） */
async function getRows(sheetName: string, headers: string[]): Promise<string[][]> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quoteSheetName(sheetName)}!A2:AZ`,
  })
  return (res.data.values ?? []) as string[][]
}

/** 指定シートをヘッダー行込みで取得する（外部取込用） */
export async function getSheetValues(
  sheetName: string,
  spreadsheetId: string = SPREADSHEET_ID
): Promise<string[][]> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: quoteSheetName(sheetName),
  })
  return (res.data.values ?? []) as string[][]
}

/** 行を末尾に追加 */
async function appendRow(sheetName: string, row: string[]): Promise<void> {
  const sheets = getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  })
}

/** ID で行を検索して更新 */
async function updateRowById(
  sheetName: string,
  headers: string[],
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  const sheets = getSheetsClient()
  const rows = await getRows(sheetName, headers)
  const rowIndex = rows.findIndex((r) => r[0] === id)
  if (rowIndex === -1) throw new Error(`ID "${id}" not found in ${sheetName}`)

  const sheetRowIndex = rowIndex + 2 // 1-indexed + ヘッダー行
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${sheetRowIndex}:AZ${sheetRowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [objToRow(headers, data)] },
  })
}

// ─── 予約 ─────────────────────────────────────────────────────

export async function getReservations(): Promise<Reservation[]> {
  const rows = await getRows(SHEET.RESERVATIONS, HEADERS.RESERVATIONS)
  return rows.map((r) => rowToObj<Reservation>(HEADERS.RESERVATIONS, r))
}

export async function addReservation(data: Reservation): Promise<void> {
  await appendRow(SHEET.RESERVATIONS, objToRow(HEADERS.RESERVATIONS, data as unknown as Record<string, unknown>))
}

export async function updateReservation(id: string, data: Partial<Reservation>): Promise<void> {
  const table = await getSheetValues(SHEET.RESERVATIONS)
  const headers = table[0] ?? []
  if (headers.some((key, i) => key !== HEADERS.RESERVATIONS[i]) || table.slice(1).some((row) => row.slice(headers.length).some((cell) => cell !== ''))) {
    throw new Error('Reservation schema migration required')
  }
  if (headers.length !== HEADERS.RESERVATIONS.length) {
    await getSheetsClient().spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID,
      range: "'予約'!A1:M1", valueInputOption: 'RAW', requestBody: { values: [HEADERS.RESERVATIONS] } })
  }
  const all = await getReservations()
  const existing = all.find((r) => r.id === id)
  if (!existing) throw new Error(`Reservation ${id} not found`)
  await updateRowById(SHEET.RESERVATIONS, HEADERS.RESERVATIONS, id, { ...existing, ...data })
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  return readQuestionnaireTable(await getSheetValues(SHEET.QUESTIONNAIRES)) as unknown as QuestionnaireData[]
}

let questionnaireWriteQueue: Promise<void> = Promise.resolve()

export async function addQuestionnaire(
  data: Omit<QuestionnaireData, 'id'>
): Promise<QuestionnaireData> {
  let saved: QuestionnaireData | undefined
  const write = async () => {
    const table = await getSheetValues(SHEET.QUESTIONNAIRES)
    const headers = requireCanonicalHeaders(table[0] ?? [])
    const all = readQuestionnaireTable(table) as unknown as QuestionnaireData[]
    saved = { ...data, id: nextQuestionnaireId(all) }
    await appendRow(
      SHEET.QUESTIONNAIRES,
      questionnaireRow(headers, saved as unknown as Record<string, unknown>)
    )
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

// ─── 顧客台帳 ─────────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  const rows = await getRows(SHEET.CUSTOMERS, HEADERS.CUSTOMERS)
  return rows.map((r) => rowToObj<Customer>(HEADERS.CUSTOMERS, r))
}

export async function addCustomer(data: Customer): Promise<void> {
  await appendRow(SHEET.CUSTOMERS, objToRow(HEADERS.CUSTOMERS, data as unknown as Record<string, unknown>))
}

export async function updateCustomer(id: string, data: Partial<Customer>): Promise<void> {
  const all = await getCustomers()
  const existing = all.find((c) => c.id === id)
  if (!existing) throw new Error(`Customer ${id} not found`)
  await updateRowById(SHEET.CUSTOMERS, HEADERS.CUSTOMERS, id, { ...existing, ...data })
}

// ─── スプレッドシート初期化（初回セットアップ用） ────────────────
/**
 * 空シートにのみヘッダーを書き込む。既存シートの移行は専用手順で行う。
 * 初回セットアップ時に実行（/api/setup エンドポイント経由）。
 */
export async function initializeSheets(): Promise<void> {
  const sheets = getSheetsClient()

  for (const [sheetName, headers] of [
    [SHEET.RESERVATIONS, HEADERS.RESERVATIONS],
    [SHEET.QUESTIONNAIRES, HEADERS.QUESTIONNAIRES],
    [SHEET.CUSTOMERS, HEADERS.CUSTOMERS],
  ] as const) {
    // Never relabel populated sheets: this corrupts conflicting legacy layouts.
    const existing = await getSheetValues(sheetName)
    if (existing.some((row) => row.some((cell) => cell !== ''))) continue
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${quoteSheetName(sheetName)}!A1:ZZ1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers as string[]] },
    })
  }
}
