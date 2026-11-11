import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'
import { query, withTransaction } from './db'
import { withStoreWriteLock } from './storeLock'
import { cachedRead, invalidateReadCache, reserveSharedSheetsReadSlot } from './readCache'

export type CheckinHandoff = { id: string; questionnaireId: string; createdAt: string; expiresAt: string }
const sheetName = '受付待ち'
const headers = ['id', 'questionnaireId', 'createdAt', 'expiresAt']
export const isSheetsStore = () => process.env.DATA_STORE === 'sheets' || (!process.env.DATA_STORE && Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SPREADSHEET_ID))
const file = () => path.join(process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data'), 'checkin-handoffs.json')
const live = (rows: CheckinHandoff[]) => rows.filter(row => Date.parse(row.expiresAt) > Date.now())

function sheetsClient() {
  return google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
    credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n') },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }) })
}

async function readLegacy(): Promise<CheckinHandoff[]> {
  if (isSheetsStore()) {
    const client = sheetsClient()
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID!
    await reserveSharedSheetsReadSlot()
    const metadata = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })
    if (!metadata.data.sheets?.some(s => s.properties?.title === sheetName)) return []
    await reserveSharedSheetsReadSlot()
    const result = await client.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A:D` })
    const values = result.data.values ?? []
    if (values.length && headers.some((header, index) => values[0][index] !== header)) throw new Error('受付待ちシートの列が不正です')
    return values.slice(1).filter(row => row[0]).map(row => ({ id: row[0], questionnaireId: row[1], createdAt: row[2], expiresAt: row[3] }))
  }
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as CheckinHandoff[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeLegacy(rows: CheckinHandoff[], previousCount: number) {
  if (isSheetsStore()) {
    const client = sheetsClient()
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID!
    await reserveSharedSheetsReadSlot()
    const metadata = await client.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })
    if (!metadata.data.sheets?.some(s => s.properties?.title === sheetName)) {
      await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] } })
    }
    const values = [headers, ...rows.map(row => headers.map(key => row[key as keyof CheckinHandoff]))]
    while (values.length < previousCount + 1) values.push(['', '', '', ''])
    try {
      await client.spreadsheets.values.update({ spreadsheetId, range: `'${sheetName}'!A1`, valueInputOption: 'RAW', requestBody: { values } })
    } finally {
      invalidateReadCache()
    }
    return
  }
  await fs.mkdir(path.dirname(file()), { recursive: true })
  const temporary = `${file()}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(rows), 'utf8')
  await fs.rename(temporary, file())
}

export async function listCheckinHandoffs(): Promise<CheckinHandoff[]> {
  if (process.env.DATA_STORE === 'postgres') {
    const result = await query('SELECT id, questionnaire_id AS "questionnaireId", created_at AS "createdAt", expires_at AS "expiresAt" FROM checkin_handoffs WHERE expires_at > now() ORDER BY created_at')
    return result.rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() })) as CheckinHandoff[]
  }
  return live(await (isSheetsStore() ? cachedRead('CHECKIN_HANDOFFS', readLegacy) : readLegacy()))
}

export async function enqueueCheckinHandoff(questionnaireId: string, expiresAt: string): Promise<void> {
  if (process.env.DATA_STORE === 'postgres') {
    await withTransaction(async client => {
      await client.query('DELETE FROM checkin_handoffs WHERE expires_at <= now()')
      await client.query('INSERT INTO checkin_handoffs(id, questionnaire_id, created_at, expires_at) VALUES ($1, $2, now(), $3) ON CONFLICT (questionnaire_id) DO NOTHING', [randomUUID(), questionnaireId, expiresAt])
    })
    return
  }
  await withStoreWriteLock(async () => {
    const previous = await readLegacy()
    const rows = live(previous)
    if (!rows.some(row => row.questionnaireId === questionnaireId)) rows.push({ id: randomUUID(), questionnaireId, createdAt: new Date().toISOString(), expiresAt })
    await writeLegacy(rows, previous.length)
  })
}

export async function dismissCheckinHandoff(id: string): Promise<void> {
  if (process.env.DATA_STORE === 'postgres') {
    await query('DELETE FROM checkin_handoffs WHERE id = $1 OR expires_at <= now()', [id])
    return
  }
  await withStoreWriteLock(async () => {
    const previous = await readLegacy()
    await writeLegacy(live(previous).filter(row => row.id !== id), previous.length)
  })
}
