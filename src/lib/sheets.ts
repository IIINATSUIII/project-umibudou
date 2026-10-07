import { google } from 'googleapis'
import type {
  Reservation,
  ReservationInput,
  QuestionnaireData,
  Customer,
  RosterEntry,
} from '@/types'
import {
  HEADERS as STORE_HEADERS,
  assertKnownHeaders,
  normalizeRecord,
  type StoreKind,
  type RecordValue,
} from './storeSchema'
import { withStoreWriteLock } from './storeLock'
import { withRetry } from './withRetry'
import { matchesCustomer } from './customerSearch'
import { matchesQuestionnaire, nextQuestionnaireId } from './questionnaireUtils'
import { normalizeReservationInput, normalizeReservationPatch } from './reservationNormalization'
import {
  createReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from './reservationQuestionnaireToken'
export const HEADERS = {
  ...STORE_HEADERS,
  RESERVATIONS: [...STORE_HEADERS.RESERVATIONS, 'questionnaireIds'],
  QUESTIONNAIRES: [
    ...STORE_HEADERS.QUESTIONNAIRES,
    'highBloodPressure',
    'doctorDivingPermit',
    'staffReviewStatus',
    'staffReviewNotes',
    'submissionId',
  ],
  CUSTOMERS: [...STORE_HEADERS.CUSTOMERS, 'registeredAt', 'countedReservationIds'],
}

const names: Record<StoreKind, string> = {
  RESERVATIONS: '予約',
  QUESTIONNAIRES: '問診票',
  CUSTOMERS: '顧客台帳',
  ROSTER: '名簿',
}
const spreadsheetId = () => process.env.GOOGLE_SPREADSHEET_ID!
const quote = (name: string) => `'${name.replace(/'/g, "''")}'`
function client() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}
// ─── シート名定義 ────────────────────────────────────────────
const SHEET = names

const getSheetsClient = client

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`
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
  time: 'legacyTime',
}

function canonicalHeader(sheetName: string, header: string): string {
  return sheetName === SHEET.RESERVATIONS ? String(RESERVATION_HEADER_ALIASES[header] ?? header) : header
}

function reservationFromRow(headers: string[], row: string[]): Reservation {
  const raw = rowToObj<Record<string, unknown>>(headers, row)
  const current = normalizeRecord('RESERVATIONS', raw) as Reservation
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
  const time = String(raw.time || raw.legacyTime || current.legacyTime || '')
  const issue11 = normalizeReservationInput({
    ...raw,
    id: raw.id || current.id,
    diveDate: raw.diveDate || raw.date || current.diveDate,
    guestPhone: raw.guestPhone || raw.phone || current.guestPhone,
    courseName: raw.courseName || raw.course || current.courseName,
    staffNote: raw.staffNote || raw.notes || current.staffNote,
    time,
  } as ReservationInput)
  return {
    ...current,
    ...issue11,
    // Keep main's status/time-slot normalization, but do not infer a course ID
    // from free text and retain the exact legacy time for Issue #11 callers.
    status: current.status,
    timeSlot: current.timeSlot,
    guestCount: current.guestCount,
    courseId: raw.courseId ? String(raw.courseId) : undefined,
    time: time || undefined,
    legacyTime: time || undefined,
    legacyChannel: String(raw.legacyChannel || raw.channel || current.legacyChannel || '') || undefined,
  }
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
    spreadsheetId: spreadsheetId(),
    range: quoteSheetName(sheetName),
  }
  const res = timeoutMs
    ? await sheets.spreadsheets.values.get(params, { timeout: timeoutMs })
    : await sheets.spreadsheets.values.get(params)
  const values = (res.data.values ?? []) as string[][]
  return { headers: values[0] ?? [], rows: values.slice(1) }
}

/** Googleフォーム取込も同じ読取ヘルパーを使用する。 */
export async function getSheetValues(
  sheetName: string,
  id = spreadsheetId()
): Promise<string[][]> {
  // API制限(429)で拒否された呼び出しだけを指数バックオフで再送する（詳細設計書 2-5-1）。
  // 拒否された呼び出しは未処理なので再送しても二重登録にならない。
  const r = await withRetry(() =>
    client().spreadsheets.values.get({
      spreadsheetId: id,
      range: quote(sheetName),
    })
  )
  return (r.data.values ?? []).map((row) => row.map((v) => String(v ?? '')))
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
    spreadsheetId: spreadsheetId(),
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
    spreadsheetId: spreadsheetId(),
    requestBody: { valueInputOption: 'RAW', data: updates },
  }
  if (timeoutMs) await sheets.spreadsheets.values.batchUpdate(params, { timeout: timeoutMs })
  else await sheets.spreadsheets.values.batchUpdate(params)
}

export type SheetsProjectionEntity = 'customer' | 'reservation' | 'questionnaire' | 'roster'

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
    roster: { sheetName: SHEET.ROSTER, headers: HEADERS.ROSTER },
  }[entityType]
  const kind = {
    customer: 'CUSTOMERS',
    reservation: 'RESERVATIONS',
    questionnaire: 'QUESTIONNAIRES',
    roster: 'ROSTER',
  }[entityType] as StoreKind
  const id = typeof payload.id === 'string' ? payload.id : ''
  if (!id) throw new Error('Projection payload is missing an ID')

  const projection: Record<string, unknown> = { id }
  const projectionAliases: Record<string, string> = {
    legacyTime: 'time',
    registeredAt: 'createdAt',
    highBloodPressure: 'hypertension',
    doctorDivingPermit: 'doctorClearance',
    staffReviewStatus: 'staffCheckStatus',
    staffReviewNotes: 'staffCheckNote',
  }
  for (const header of config.headers) {
    const key = canonicalHeader(config.sheetName, header)
    const value = payload[key] ?? payload[header] ?? payload[projectionAliases[header]]
    projection[key] = value === undefined || value === null ? '' : value
  }

  await withStoreWriteLock(async () => {
    // Fail closed on an unmigrated sheet before applying an outbox projection.
    await snapshot(kind, true)
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
  })
}

// ─── 予約 ─────────────────────────────────────────────────────

export async function getReservations(): Promise<Reservation[]> {
  return read<Reservation>('RESERVATIONS')
}

export async function addReservation(data: ReservationInput): Promise<Reservation> {
  const normalized = normalizeReservationInput(data)
  const reservation = {
    ...normalized,
    legacyTime: normalized.legacyTime ?? normalized.time,
    legacyChannel: normalized.legacyChannel ?? normalized.channel,
    questionnaireToken: normalized.questionnaireToken ?? createReservationQuestionnaireToken(),
    questionnaireTokenExpiresAt: normalized.questionnaireTokenExpiresAt ??
      questionnaireTokenExpiryForDiveDate(normalized.diveDate),
  }
  await add('RESERVATIONS', reservation)
  return reservation
}

export async function updateReservation(id: string, data: ReservationInput): Promise<void> {
  return withStoreWriteLock(async () => {
    const all = await getReservations()
    const existing = all.find((reservation) => reservation.id === id)
    if (!existing) throw new Error(`Reservation ${id} not found`)
    const patch = normalizeReservationPatch(data)
    if (patch.time !== undefined && patch.legacyTime === undefined) {
      patch.legacyTime = patch.time
    }
    const updated = { ...existing, ...patch }
    if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
      updated.questionnaireTokenExpiresAt = questionnaireTokenExpiryForDiveDate(updated.diveDate)
    }
    const persistedPatch = { ...patch }
    delete persistedPatch.time
    if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
      persistedPatch.questionnaireTokenExpiresAt = updated.questionnaireTokenExpiresAt
    }
    await update<Reservation>('RESERVATIONS', id, persistedPatch)
  })
}

// ─── 問診票 ───────────────────────────────────────────────────

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  return read<QuestionnaireData>('QUESTIONNAIRES')
}

export async function addQuestionnaire(
  data: QuestionnaireData | Omit<QuestionnaireData, 'id'>
): Promise<QuestionnaireData> {
  let saved: QuestionnaireData | undefined
  const write = async () => {
    const providedId = 'id' in data ? data.id : undefined
    const all = providedId ? [] : await getQuestionnaires()
    saved = { ...data, id: providedId ?? nextQuestionnaireId(all) }
    await add('QUESTIONNAIRES', saved)
  }
  await withStoreWriteLock(write)
  if (!saved) throw new Error('Failed to create questionnaire')
  return saved
}

const record = (headers: string[], row: string[]) =>
  Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
const cell = (v: unknown) => (v === undefined || v === null ? '' : String(v))
async function snapshot(kind: StoreKind, write = false) {
  const values = await getSheetValues(names[kind])
  const headers = (values[0] ?? []).map((h) => h.trim())
  while (headers[headers.length - 1] === '') headers.pop()
  assertKnownHeaders(kind, headers)
  if (write && !HEADERS[kind].every((h) => headers.includes(h)))
    throw new Error(
      `${kind}は旧スキーマです。POST /api/setup で移行してください`
    )
  const rows = values
    .slice(1)
    .map((r, i) => ({ raw: r, index: i + 2 }))
    .filter((r) => r.raw.some((v) => v !== ''))
  const data = rows.map((r) =>
    kind === 'RESERVATIONS'
      ? reservationFromRow(headers, r.raw)
      : normalizeRecord(kind, record(headers, r.raw))
  )
  const ids = data.map((v) => v.id)
  if (new Set(ids).size !== ids.length)
    throw new Error(`${kind}に重複IDがあります`)
  return { headers, rows, data }
}
async function read<T>(kind: StoreKind): Promise<T[]> {
  return (await snapshot(kind)).data as T[]
}
export async function getQuestionnaireById(id: string): Promise<QuestionnaireData | undefined> {
  const all = await getQuestionnaires()
  return all.find((questionnaire) => questionnaire.id === id)
}

export async function updateQuestionnaire(
  id: string,
  data: Partial<QuestionnaireData>
): Promise<QuestionnaireData> {
  return withStoreWriteLock(async () => {
    const all = await getQuestionnaires()
    const existing = all.find((questionnaire) => questionnaire.id === id)
    if (!existing) throw new Error(`Questionnaire ${id} not found`)
    await update<QuestionnaireData>('QUESTIONNAIRES', id, data)
    return { ...existing, ...data }
  })
}

// ─── 顧客台帳 ─────────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  return read<Customer>('CUSTOMERS')
}

export async function addCustomer(data: Customer): Promise<void> {
  await add('CUSTOMERS', data)
}

export async function updateCustomer(id: string, data: Partial<Customer>): Promise<void> {
  return withStoreWriteLock(async () => {
    const all = await getCustomers()
    const existing = all.find((customer) => customer.id === id)
    if (!existing) throw new Error(`Customer ${id} not found`)
    await update<Customer>('CUSTOMERS', id, data)
  })
}

// ─── 追記のみの旧セットアップ処理（互換用） ─────────────────────
/**
 * 不足ヘッダーだけを既存データの右端へ追加する。既存ヘッダーと既存行は変更しない。
 * 初回セットアップ時またはスキーマ更新後に実行（/api/setup エンドポイント経由）。
 */
export async function initializeSheetsByAppendingMissingHeaders(): Promise<void> {
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
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(sheetName)}!${start}1:${end}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [missingHeaders as string[]] },
    })
  }
}

async function add<T extends { id: string }>(kind: StoreKind, v: T) {
  return withStoreWriteLock(async () => {
    const s = await snapshot(kind, true)
    if (s.data.some((r) => r.id === v.id))
      throw new Error(`ID ${v.id} は登録済みです`)
    await withRetry(() =>
      client().spreadsheets.values.append({
        spreadsheetId: spreadsheetId(),
        range: `${quote(names[kind])}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [
            s.headers.map((h) => cell((v as unknown as RecordValue)[h])),
          ],
        },
      })
    )
  })
}
function column(index: number) {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  return result
}
async function update<T>(kind: StoreKind, id: string, delta: Partial<T>) {
  return withStoreWriteLock(async () => {
    const s = await snapshot(kind, true)
    const index = s.data.findIndex((r) => r.id === id)
    if (index < 0) throw new Error(`${kind} ${id} not found`)
    // 変更したセルだけ書く。未知の列や別スタッフの別項目を全行書込で失わない。
    const data = Object.entries(delta)
      .filter(([h]) => h !== 'id')
      .map(([h, v]) => {
        const col = s.headers.indexOf(h)
        if (col < 0) throw new Error(`未定義列 ${h}`)
        return {
          range: `${quote(names[kind])}!${column(col)}${s.rows[index].index}`,
          values: [[cell(v)]],
        }
      })
    if (data.length)
      await withRetry(() =>
        client().spreadsheets.values.batchUpdate({
          spreadsheetId: spreadsheetId(),
          requestBody: { valueInputOption: 'RAW', data },
        })
      )
  })
}
export const searchQuestionnaires = async (q: string) =>
  (await getQuestionnaires()).filter((v) => matchesQuestionnaire(v, q))
export const searchCustomers = async (q: string) =>
  (await getCustomers()).filter((v) => matchesCustomer(v, q))
export const getRoster = () => read<RosterEntry>('ROSTER')
export const addRoster = (v: RosterEntry) => add('ROSTER', v)

/** バックアップの複製後、一回の原子的batchUpdateで列名と全行を移行する。 */
export async function initializeSheets() {
  return withStoreWriteLock(async () => {
    const sheets = client()
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId(),
      fields: 'sheets.properties',
    })
    const results = []
    for (const kind of Object.keys(names) as StoreKind[]) {
      const properties = metadata.data.sheets?.find(
        (s) => s.properties?.title === names[kind]
      )?.properties
      const values = properties ? await getSheetValues(names[kind]) : []
      const headers = (values[0] ?? []).map((h) => h.trim())
      while (headers[headers.length - 1] === '') headers.pop()
      const populated = values.slice(1).some((r) => r.some((v) => v !== ''))
      if (populated && !headers.length)
        throw new Error(`${kind}にヘッダーなしの既存データがあります`)
      if (headers.length) assertKnownHeaders(kind, headers)
      if (HEADERS[kind].every((h) => headers.includes(h))) {
        results.push({ kind, status: 'already_current' })
        continue
      }
      const extra = headers.filter((h) => !HEADERS[kind].includes(h))
      const target = [...HEADERS[kind], ...extra]
      const rows = values.slice(1).filter((r) => r.some((v) => v !== ''))
      const normalized = rows.map((row) =>
        (kind === 'RESERVATIONS'
          ? reservationFromRow(headers, row)
          : normalizeRecord(kind, record(headers, row))) as unknown as RecordValue
      )
      if (new Set(normalized.map((r) => r.id)).size !== normalized.length)
        throw new Error(`${kind}に重複IDがあります`)
      let sheetId = properties?.sheetId
      let backup: string | undefined
      if (sheetId == null) {
        const added = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId(),
          requestBody: {
            requests: [{ addSheet: { properties: { title: names[kind] } } }],
          },
        })
        sheetId =
          added.data.replies?.[0].addSheet?.properties?.sheetId ?? undefined
      } else if (populated) {
        backup = `${names[kind]}_backup_${Date.now()}_${kind}`
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId(),
          requestBody: {
            requests: [
              {
                duplicateSheet: {
                  sourceSheetId: sheetId,
                  newSheetName: backup,
                },
              },
            ],
          },
        })
      }
      if (sheetId == null) throw new Error('シートIDを取得できません')
      const output = [
        target,
        ...normalized.map((v) => target.map((h) => cell(v[h]))),
      ]
      // 行位置変更による参照消失を避け、IDを保持する。空行の圧縮は移行時だけ行う。
      const requests = [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                columnCount: Math.max(
                  target.length,
                  properties?.gridProperties?.columnCount ?? 26
                ),
                rowCount: Math.max(
                  output.length,
                  properties?.gridProperties?.rowCount ?? 1000
                ),
              },
            },
            fields: 'gridProperties.columnCount,gridProperties.rowCount',
          },
        },
        {
          updateCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: Math.max(output.length, values.length),
              startColumnIndex: 0,
              endColumnIndex: target.length,
            },
            rows: output.map((row) => ({
              values: row.map((v) => ({
                userEnteredValue: { stringValue: v },
              })),
            })),
            fields: 'userEnteredValue',
          },
        },
      ]
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId(),
        requestBody: { requests },
      })
      results.push({
        kind,
        status: populated ? 'migrated' : 'initialized',
        rowCount: rows.length,
        backup,
      })
    }
    return results
  })
}
