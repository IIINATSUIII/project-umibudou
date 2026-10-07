/**
 * Local JSON datastore for environments without Google Sheets.
 * Writes use a shared lock, preserve a one-time pre-migration backup, and
 * replace files atomically so interrupted writes do not corrupt existing data.
 */

import { promises as fs, constants } from 'fs'
import { randomUUID } from 'crypto'
import path from 'path'
import type {
  Reservation,
  ReservationInput,
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
import {
  matchesQuestionnaire,
  nextQuestionnaireId,
} from './questionnaireUtils'
import {
  normalizeReservationInput,
  normalizeReservationPatch,
} from './reservationNormalization'
import {
  createReservationQuestionnaireToken,
  questionnaireTokenExpiryForDiveDate,
} from './reservationQuestionnaireToken'

const directory = () =>
  process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data')

const names: Record<StoreKind, string> = {
  RESERVATIONS: 'reservations',
  QUESTIONNAIRES: 'questionnaires',
  CUSTOMERS: 'customers',
  ROSTER: 'roster',
}

const seeds: Record<StoreKind, unknown[]> = {
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
    rows.some((value) => !value || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new Error(`${kind}のJSON形式が不正です`)
  }

  const ids = rows.map((value) => (value as RecordValue).id)
  if (
    ids.some((id) => typeof id !== 'string' || !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error(`${kind}に欠落・重複IDがあります`)
  }

  return rows.map((value) =>
    normalizeRecord(kind, value as RecordValue)
  ) as T[]
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
    ) {
      throw err
    }
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
    if (rows.some((value) => value.id === data.id)) {
      throw new Error(`ID ${data.id} は登録済みです`)
    }
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
    const index = rows.findIndex((value) => value.id === id)
    if (index < 0) throw new Error(`${kind} ${id} not found`)
    rows[index] = { ...rows[index], ...delta, id }
    await write(kind, rows)
  })
}

// ─── Reservations ─────────────────────────────────────────────

export async function getReservations(): Promise<Reservation[]> {
  const rows = await read<Reservation>('RESERVATIONS')
  return rows.map((row) => normalizeReservationInput(row))
}

export async function addReservation(
  data: ReservationInput
): Promise<Reservation> {
  return withStoreWriteLock(async () => {
    const normalized = normalizeReservationInput(data)
    const reservation: Reservation = {
      ...normalized,
      questionnaireToken:
        normalized.questionnaireToken ?? createReservationQuestionnaireToken(),
      questionnaireTokenExpiresAt:
        normalized.questionnaireTokenExpiresAt ??
        questionnaireTokenExpiryForDiveDate(normalized.diveDate),
    }
    const all = await getReservations()
    if (all.some((row) => row.id === reservation.id)) {
      throw new Error(`ID ${reservation.id} は登録済みです`)
    }
    all.push(reservation)
    await write('RESERVATIONS', all)
    return reservation
  })
}

export async function updateReservation(
  id: string,
  data: ReservationInput
): Promise<void> {
  return withStoreWriteLock(async () => {
    const all = await getReservations()
    const index = all.findIndex((row) => row.id === id)
    if (index < 0) throw new Error(`Reservation ${id} not found`)

    const patch = normalizeReservationPatch(data)
    const updated = { ...all[index], ...patch }
    if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
      updated.questionnaireTokenExpiresAt =
        questionnaireTokenExpiryForDiveDate(updated.diveDate)
    }
    all[index] = updated
    await write('RESERVATIONS', all)
  })
}

// ─── Questionnaires ───────────────────────────────────────────

export const getQuestionnaires = () =>
  read<QuestionnaireData>('QUESTIONNAIRES')

export async function addQuestionnaire(
  data: Omit<QuestionnaireData, 'id'>
): Promise<QuestionnaireData> {
  let saved: QuestionnaireData | undefined
  await withStoreWriteLock(async () => {
    const all = await getQuestionnaires()
    saved = { ...data, id: nextQuestionnaireId(all) }
    all.push(saved)
    await write('QUESTIONNAIRES', all)
  })
  if (!saved) throw new Error('Failed to create questionnaire')
  return saved
}

export const searchQuestionnaires = async (query: string) =>
  (await getQuestionnaires()).filter((questionnaire) =>
    matchesQuestionnaire(questionnaire, query)
  )

export const getQuestionnaireById = async (id: string) =>
  (await getQuestionnaires()).find((questionnaire) => questionnaire.id === id)

export async function updateQuestionnaire(
  id: string,
  data: Partial<QuestionnaireData>
): Promise<QuestionnaireData> {
  return withStoreWriteLock(async () => {
    const all = await getQuestionnaires()
    const index = all.findIndex((questionnaire) => questionnaire.id === id)
    if (index < 0) throw new Error(`Questionnaire ${id} not found`)
    all[index] = { ...all[index], ...data, id }
    await write('QUESTIONNAIRES', all)
    return all[index]
  })
}

// ─── Customers ────────────────────────────────────────────────

export const getCustomers = () => read<Customer>('CUSTOMERS')
export const addCustomer = (data: Customer) => add('CUSTOMERS', data)
export const updateCustomer = (id: string, data: Partial<Customer>) =>
  update<Customer>('CUSTOMERS', id, data)
export const searchCustomers = async (query: string) =>
  (await getCustomers()).filter((customer) => matchesCustomer(customer, query))

// ─── Roster ───────────────────────────────────────────────────

export const getRoster = () => read<RosterEntry>('ROSTER')
export const addRoster = (data: RosterEntry) => add('ROSTER', data)
