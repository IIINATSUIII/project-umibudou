import { promises as fs, constants } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import type {
  Reservation,
  QuestionnaireData,
  Customer,
  RosterEntry,
} from '@/types'
import {
  MOCK_RESERVATIONS,
  MOCK_QUESTIONNAIRES,
  MOCK_CUSTOMERS,
} from './mockData'
import {
  normalizeRecord,
  type StoreKind,
  type RecordValue,
} from './storeSchema'
import { withStoreWriteLock } from './storeLock'
import { matchesCustomer } from './customerSearch'
import { matchesQuestionnaire } from './questionnaireUtils'

const directory = () =>
  process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data')
const names: Record<StoreKind, string> = {
  RESERVATIONS: 'reservations',
  QUESTIONNAIRES: 'questionnaires',
  CUSTOMERS: 'customers',
  ROSTER: 'roster',
}
const seeds = {
  RESERVATIONS: MOCK_RESERVATIONS,
  QUESTIONNAIRES: MOCK_QUESTIONNAIRES,
  CUSTOMERS: MOCK_CUSTOMERS,
  ROSTER: [],
}
async function read<T>(kind: StoreKind): Promise<T[]> {
  let rows: unknown
  try {
    rows = JSON.parse(
      await fs.readFile(path.join(directory(), `${names[kind]}.json`), 'utf8')
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    rows = structuredClone(seeds[kind])
  }
  if (
    !Array.isArray(rows) ||
    rows.some((v) => !v || typeof v !== 'object' || Array.isArray(v))
  )
    throw new Error(`${kind}のJSON形式が不正です`)
  const ids = rows.map((v) => v.id)
  if (
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length
  )
    throw new Error(`${kind}に欠落・重複IDがあります`)
  return rows.map((v) => normalizeRecord(kind, v as RecordValue)) as T[]
}
async function write<T>(kind: StoreKind, rows: T[]): Promise<void> {
  await fs.mkdir(directory(), { recursive: true })
  const file = path.join(directory(), `${names[kind]}.json`)
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.copyFile(
      file,
      `${file}.before-review-migration`,
      constants.COPYFILE_EXCL
    )
  } catch (err) {
    if (
      !['ENOENT', 'EEXIST'].includes((err as NodeJS.ErrnoException).code || '')
    )
      throw err
  }
  await fs.writeFile(temp, JSON.stringify(rows, null, 2), 'utf8')
  try {
    await fs.rename(temp, file)
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined)
    throw err
  }
}
async function add<T extends { id: string }>(
  kind: StoreKind,
  data: T
): Promise<void> {
  return withStoreWriteLock(async () => {
    const rows = await read<T>(kind)
    if (rows.some((v) => v.id === data.id))
      throw new Error(`ID ${data.id} は登録済みです`)
    rows.push(data)
    await write(kind, rows)
  })
}
async function update<T extends { id: string }>(
  kind: StoreKind,
  id: string,
  delta: Partial<T>
): Promise<void> {
  return withStoreWriteLock(async () => {
    const rows = await read<T>(kind)
    const index = rows.findIndex((v) => v.id === id)
    if (index < 0) throw new Error(`${kind} ${id} not found`)
    rows[index] = { ...rows[index], ...delta, id }
    await write(kind, rows)
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
