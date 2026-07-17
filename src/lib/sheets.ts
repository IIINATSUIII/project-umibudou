/**
 * Google Sheets API クライアント（サーバーサイド専用）
 * Next.js の API Route からのみ呼び出すこと。
 */

import { google } from 'googleapis'
import type { Reservation, QuestionnaireData, Customer } from '@/types'

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

// ─── ヘッダー行（スプレッドシート初期化用） ─────────────────────
export const HEADERS = {
  RESERVATIONS:   ['id','date','time','course','guestName','guestCount','phone','channel','status','questionnaireId','notes'],
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
  ],
  CUSTOMERS: [
    'id','lastName','firstName','lastNameKana','firstNameKana',
    'phone','email','lastVisit','visitCount',
    'hasCCard','cCardType','totalDives','healthNotes','guideNotes',
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
    // number 変換
    else if (h === 'guestCount' || h === 'sleepHours' || h === 'totalDives' || h === 'visitCount') {
      obj[h] = val === '' ? 0 : Number(val)
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
    range: `${sheetName}!A2:AZ`,
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
  await appendRow(SHEET.RESERVATIONS, objToRow(HEADERS.RESERVATIONS, data as Record<string, unknown>))
}

export async function updateReservation(id: string, data: Partial<Reservation>): Promise<void> {
  const all = await getReservations()
  const existing = all.find((r) => r.id === id)
  if (!existing) throw new Error(`Reservation ${id} not found`)
  await updateRowById(SHEET.RESERVATIONS, HEADERS.RESERVATIONS, id, { ...existing, ...data })
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  const rows = await getRows(SHEET.QUESTIONNAIRES, HEADERS.QUESTIONNAIRES)
  return rows.map((r) => rowToObj<QuestionnaireData>(HEADERS.QUESTIONNAIRES, r))
}

export async function addQuestionnaire(data: QuestionnaireData): Promise<void> {
  await appendRow(
    SHEET.QUESTIONNAIRES,
    objToRow(HEADERS.QUESTIONNAIRES, data as Record<string, unknown>)
  )
}

// ─── 顧客台帳 ─────────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  const rows = await getRows(SHEET.CUSTOMERS, HEADERS.CUSTOMERS)
  return rows.map((r) => rowToObj<Customer>(HEADERS.CUSTOMERS, r))
}

export async function addCustomer(data: Customer): Promise<void> {
  await appendRow(SHEET.CUSTOMERS, objToRow(HEADERS.CUSTOMERS, data as Record<string, unknown>))
}

export async function updateCustomer(id: string, data: Partial<Customer>): Promise<void> {
  const all = await getCustomers()
  const existing = all.find((c) => c.id === id)
  if (!existing) throw new Error(`Customer ${id} not found`)
  await updateRowById(SHEET.CUSTOMERS, HEADERS.CUSTOMERS, id, { ...existing, ...data })
}

// ─── スプレッドシート初期化（初回セットアップ用） ────────────────
/**
 * 各シートのヘッダー行を書き込む。
 * 初回セットアップ時に一度だけ実行（/api/setup エンドポイント経由）。
 */
export async function initializeSheets(): Promise<void> {
  const sheets = getSheetsClient()

  for (const [sheetName, headers] of [
    [SHEET.RESERVATIONS, HEADERS.RESERVATIONS],
    [SHEET.QUESTIONNAIRES, HEADERS.QUESTIONNAIRES],
    [SHEET.CUSTOMERS, HEADERS.CUSTOMERS],
  ] as const) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:AZ1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers as string[]] },
    })
  }
}
