import { google } from 'googleapis'
import type {
  Reservation,
  QuestionnaireData,
  Customer,
  RosterEntry,
} from '@/types'
import {
  HEADERS,
  assertKnownHeaders,
  normalizeRecord,
  type StoreKind,
  type RecordValue,
} from './storeSchema'
import { withStoreWriteLock } from './storeLock'
import { matchesCustomer } from './customerSearch'
import { matchesQuestionnaire } from './questionnaireUtils'
export { HEADERS } from './storeSchema'

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
/** Googleフォーム取込も同じ読取ヘルパーを使用する。 */
export async function getSheetValues(
  sheetName: string,
  id = spreadsheetId()
): Promise<string[][]> {
  const r = await client().spreadsheets.values.get({
    spreadsheetId: id,
    range: quote(sheetName),
  })
  return (r.data.values ?? []).map((row) => row.map((v) => String(v ?? '')))
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
  const data = rows.map((r) => normalizeRecord(kind, record(headers, r.raw)))
  const ids = data.map((v) => v.id)
  if (new Set(ids).size !== ids.length)
    throw new Error(`${kind}に重複IDがあります`)
  return { headers, rows, data }
}
async function read<T>(kind: StoreKind): Promise<T[]> {
  return (await snapshot(kind)).data as T[]
}
async function add<T extends { id: string }>(kind: StoreKind, v: T) {
  return withStoreWriteLock(async () => {
    const s = await snapshot(kind, true)
    if (s.data.some((r) => r.id === v.id))
      throw new Error(`ID ${v.id} は登録済みです`)
    await client().spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: `${quote(names[kind])}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [s.headers.map((h) => cell((v as unknown as RecordValue)[h]))],
      },
    })
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
      await client().spreadsheets.values.batchUpdate({
        spreadsheetId: spreadsheetId(),
        requestBody: { valueInputOption: 'RAW', data },
      })
  })
}
export const getReservations = () => read<Reservation>('RESERVATIONS')
export const addReservation = (v: Reservation) => add('RESERVATIONS', v)
export const updateReservation = (id: string, v: Partial<Reservation>) =>
  update<Reservation>('RESERVATIONS', id, v)
export const getQuestionnaires = () => read<QuestionnaireData>('QUESTIONNAIRES')
export const addQuestionnaire = (v: QuestionnaireData) =>
  add('QUESTIONNAIRES', v)
export const updateQuestionnaire = (
  id: string,
  v: Partial<QuestionnaireData>
) => update<QuestionnaireData>('QUESTIONNAIRES', id, v)
export const searchQuestionnaires = async (q: string) =>
  (await getQuestionnaires()).filter((v) => matchesQuestionnaire(v, q))
export const getQuestionnaireById = async (id: string) =>
  (await getQuestionnaires()).find((v) => v.id === id)
export const getCustomers = () => read<Customer>('CUSTOMERS')
export const addCustomer = (v: Customer) => add('CUSTOMERS', v)
export const updateCustomer = (id: string, v: Partial<Customer>) =>
  update<Customer>('CUSTOMERS', id, v)
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
      const normalized = rows.map(
        (r) =>
          normalizeRecord(kind, record(headers, r)) as unknown as RecordValue
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
      } else if (values.length) {
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
