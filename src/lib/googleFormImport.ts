/**
 * Google Forms の回答先スプレッドシートから予約を取り込む。
 * Google Forms API や GAS は使わず、同じスプレッドシートの回答タブを読む。
 */

import { generateQuestionnaireToken,getQuestionnaireExpiry } from './questionnaireToken'
import { withStoreWriteLock } from './storeLock'
import { createHash } from 'crypto'
import { USE_SHEETS, store } from './dataStore'
import { getSheetValues } from './sheets'
import { ISSUE_5_RESERVATION_STATUS } from './reservationStatus'
import type { Reservation } from '@/types'

type ReservationField = 'date' | 'time' | 'course' | 'guestName' | 'guestCount' | 'phone' | 'notes'

export type GoogleFormImportResult = {
  enabled: boolean
  imported: number
  skipped: number
  errors: string[]
}

const DEFAULT_HEADER_ALIASES: Record<ReservationField, string[]> = {
  date: ['希望日', 'ダイビング希望日', '予約日', 'ご希望日', '利用日', '日付', '希望日時', '予約日時'],
  time: ['希望時間', 'ダイビング希望時間', '予約時間', 'ご希望時間', '開始時間', '時間'],
  course: ['コース', '希望コース', 'ご希望のコース', '参加メニュー', 'メニュー'],
  guestName: ['お名前', '氏名', '代表者氏名', '名前', 'お名前（代表者）', '代表者のお名前'],
  guestCount: ['人数', '参加人数', 'ご利用人数', '参加者数'],
  phone: ['電話番号', '連絡先', '携帯電話番号', '電話'],
  notes: ['備考', 'ご要望', 'ご要望・メモ', 'メッセージ', 'その他'],
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[（）()・／/:：]/g, '')
    .toLowerCase()
}

function getConfiguredHeaderMap(): Partial<Record<ReservationField, string>> {
  const raw = process.env.GOOGLE_FORM_HEADER_MAP
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const allowed: ReservationField[] = ['date', 'time', 'course', 'guestName', 'guestCount', 'phone', 'notes']
    return Object.fromEntries(
      allowed
        .filter((field) => typeof parsed[field] === 'string' && parsed[field])
        .map((field) => [field, parsed[field] as string])
    ) as Partial<Record<ReservationField, string>>
  } catch {
    console.warn('[googleFormImport] GOOGLE_FORM_HEADER_MAP はJSONとして解釈できません')
    return {}
  }
}

function findColumn(headers: string[], field: ReservationField, configured: Partial<Record<ReservationField, string>>): number {
  const candidates = configured[field]
    ? [configured[field] as string, ...DEFAULT_HEADER_ALIASES[field]]
    : DEFAULT_HEADER_ALIASES[field]
  const normalized = new Set(candidates.map(normalizeHeader))
  return headers.findIndex((header) => normalized.has(normalizeHeader(header)))
}

function cell(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? '').trim() : ''
}

function parseDate(value: string): string | null {
  const text = value.trim()
  let match = text.match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})日?/)
  if (match) {
    const [, year, month, day] = match
    return toIsoDate(Number(year), Number(month), Number(day))
  }

  match = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (match) {
    const [, month, day, year] = match
    return toIsoDate(Number(year), Number(month), Number(day))
  }

  return null
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseTime(value: string): string | null {
  const text = value.trim()
  const colon = text.match(/(午前|午後)?\s*(\d{1,2})[:：](\d{2})/)
  const japanese = text.match(/(午前|午後)\s*(\d{1,2})時(?:\s*(\d{1,2})分)?/)
  const match = colon ?? japanese
  if (!match) return null

  const period = match[1]
  const hour = Number(match[2])
  const minute = Number(match[3] ?? 0)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  let normalizedHour = hour
  if (period === '午後' && hour < 12) normalizedHour += 12
  if (period === '午前' && hour === 12) normalizedHour = 0
  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseDateTime(value: string): { date: string | null; time: string | null } {
  return { date: parseDate(value), time: parseTime(value) }
}

function parseGuestCount(value: string): number | null {
  const match = value.match(/\d+/)
  if (!match) return null
  const count = Number(match[0])
  return Number.isInteger(count) && count >= 1 && count <= 20 ? count : null
}

function makeReservationId(spreadsheetId: string, sheetName: string, rowNumber: number): string {
  const source = `${spreadsheetId}:${sheetName}:${rowNumber}`
  return `GF-${createHash('sha256').update(source).digest('hex').slice(0, 12).toUpperCase()}`
}

/**
 * 回答タブの未取込行を仮予約として追加する。
 * 予約一覧取得時に呼び出すため、スタッフ画面を開いている間は自動反映される。
 */
let importInFlight: Promise<GoogleFormImportResult> | null = null

async function importGoogleFormBookingsOnce(): Promise<GoogleFormImportResult> {
  if (!USE_SHEETS) {
    return { enabled: false, imported: 0, skipped: 0, errors: [] }
  }

  const sheetName = process.env.GOOGLE_FORM_RESPONSES_SHEET || 'フォームの回答 1'
  const spreadsheetId = process.env.GOOGLE_FORM_SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || ''
  let rows: string[][]
  try {
    rows = await getSheetValues(sheetName, spreadsheetId)
  } catch (err) {
    console.error(`[googleFormImport] ${sheetName} の読み込みに失敗しました`, err)
    return { enabled: true, imported: 0, skipped: 0, errors: [`${sheetName} を読み込めません`] }
  }
  if (rows.length === 0) {
    return { enabled: true, imported: 0, skipped: 0, errors: [`${sheetName} にヘッダー行がありません`] }
  }

  const headers = rows[0].map((header) => String(header ?? ''))
  const configured = getConfiguredHeaderMap()
  const columns = Object.fromEntries(
    (Object.keys(DEFAULT_HEADER_ALIASES) as ReservationField[])
      .map((field) => [field, findColumn(headers, field, configured)])
  ) as Record<ReservationField, number>

  const requiredFields: ReservationField[] = ['date', 'time', 'course', 'guestName', 'guestCount', 'phone']
  const dateHeader = columns.date >= 0 ? normalizeHeader(headers[columns.date]) : ''
  const combinedDateTime = dateHeader.includes('日時') || dateHeader.includes('日付時間')
  const missingHeaders = requiredFields.filter(
    (field) => columns[field] < 0 && !(field === 'time' && combinedDateTime)
  )
  if (missingHeaders.length > 0) {
    return {
      enabled: true,
      imported: 0,
      skipped: 0,
      errors: [`${sheetName} に必要な見出しがありません: ${missingHeaders.join(', ')}`],
    }
  }

  const reservations = await store.getReservations()
  const existingIds = new Set(reservations.map((reservation) => reservation.id))
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    const rowNumber = index + 1
    if (!row || row.every((value) => String(value ?? '').trim() === '')) continue

    const id = makeReservationId(spreadsheetId, sheetName, rowNumber)
    if (existingIds.has(id)) {
      skipped += 1
      continue
    }

    const rawDate = cell(row, columns.date)
    const rawTime = cell(row, columns.time)
    const dateFromDate = parseDateTime(rawDate)
    const date = dateFromDate.date
    const time = parseTime(rawTime) ?? dateFromDate.time
    const course = cell(row, columns.course)
    const guestName = cell(row, columns.guestName)
    const guestCount = parseGuestCount(cell(row, columns.guestCount))
    const phone = cell(row, columns.phone)

    const invalid: string[] = []
    if (!date) invalid.push('希望日')
    if (!time) invalid.push('希望時間')
    if (!course) invalid.push('コース')
    if (!guestName) invalid.push('お名前')
    if (!guestCount) invalid.push('人数')
    if (!phone) invalid.push('電話番号')
    if (invalid.length > 0) {
      skipped += 1
      errors.push(`行${rowNumber}: ${invalid.join('、')}を確認してください`)
      continue
    }

    const now = new Date().toISOString()
    const reservation: Reservation = {
      id,
      diveDate: date as string,
      time: time as string,
      legacyTime: time as string,
      timeSlot: 'unspecified',
      courseName: course,
      guestName: guestName.slice(0, 50),
      guestCount: guestCount as number,
      guestPhone: phone.slice(0, 20),
      channel: 'google_form',
      status: ISSUE_5_RESERVATION_STATUS.requested,
      staffNote: cell(row, columns.notes).slice(0, 500),
      createdAt: now,
      updatedAt: now,
      questionnaireToken: generateQuestionnaireToken(),
      questionnaireTokenExpiresAt: getQuestionnaireExpiry(date as string),
    }
    try {
      await store.addReservation(reservation)
    } catch (err) {
      skipped += 1
      errors.push(`行${rowNumber}: 予約の保存に失敗しました`)
      console.error(`[googleFormImport] 行${rowNumber} の保存に失敗しました`, err)
      continue
    }
    existingIds.add(id)
    imported += 1
  }

  return { enabled: true, imported, skipped, errors }
}

/** 同一プロセス内の同時リクエストによる二重取込を防ぐ */
export function importGoogleFormBookings(): Promise<GoogleFormImportResult> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SPREADSHEET_ID) return importGoogleFormBookingsOnce()
  if (!importInFlight) {
    importInFlight = withStoreWriteLock(()=>importGoogleFormBookingsOnce()).finally(() => {
      importInFlight = null
    })
  }
  return importInFlight
}
