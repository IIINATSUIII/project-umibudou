/** PostgreSQL implementation of the shared datastore contract. Server-side only. */

import { randomBytes } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import type {
  Customer,
  QuestionnaireData,
  QuestionnaireFormData,
  Reservation,
  ReservationInput,
  RosterEntry,
} from '@/types'
import { matchesQuestionnaire, nextCustomerId, nextQuestionnaireId } from './questionnaireUtils'
import { matchesCustomer } from './customerSearch'
import { normalizeReservationInput, normalizeReservationPatch } from './reservationNormalization'
import { createReservationQuestionnaireToken, questionnaireTokenExpiryForDiveDate } from './reservationQuestionnaireToken'
import { isQuestionnaireReservationAllowed } from './reservationStatus'
import { query, withTransaction } from './db'
import { DataStoreError } from './dataStoreErrors'
import type {
  PublicQuestionnaireSubmission,
  PublicQuestionnaireSubmissionResult,
  QuestionnaireResolutionResult,
  StaffQuestionnaireSubmission,
} from './dataStore'

type Row = QueryResultRow
type EntityType = 'customer' | 'reservation' | 'questionnaire' | 'roster'

const RESERVATION_FIELDS: (keyof Reservation)[] = [
  'id', 'createdAt', 'updatedAt', 'customerId', 'guestName', 'guestPhone', 'guestEmail',
  'diveDate', 'time', 'timeSlot', 'courseId', 'courseName', 'guestCount', 'status',
  'staffId', 'staffName', 'channel', 'questionnaireId', 'questionnaireIds',
  'questionnaireToken', 'questionnaireTokenExpiresAt', 'questionnaireCompleted', 'divePoint', 'staffNote',
]

const QUESTIONNAIRE_FIELDS: (keyof QuestionnaireData)[] = [
  'id', 'reservationId', 'submittedAt', 'customerId', 'submissionId',
  'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'birthDate', 'gender',
  'postalCode', 'address', 'phone', 'email', 'emergencyName', 'emergencyRelation', 'emergencyPhone',
  'heartDisease', 'highBloodPressure', 'respiratoryDisease', 'earDisease', 'epilepsy', 'diabetes',
  'pregnant', 'panicDisorder', 'medication', 'medicationName', 'latexAllergy', 'sleepHours', 'sleepCategory',
  'alcoholLastNight', 'alcoholToday', 'condition', 'conditionDetails', 'flightWithin48h',
  'hasCCard', 'cCardType', 'cCardOrg', 'lastDiveDate', 'lastDivePeriod', 'totalDives',
  'medicalCertificate', 'doctorClearance', 'staffCheckStatus', 'staffCheckNote', 'submissionState',
  'agreeRisk', 'agreeMedical', 'agreePhoto', 'consentAt', 'qrToken', 'qrExpiresAt', 'qrUsed',
  'doctorDivingPermit', 'staffReviewStatus', 'staffReviewNotes',
]

const CUSTOMER_FIELDS: (keyof Customer)[] = [
  'id', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'phone', 'email', 'lastVisit',
  'visitCount', 'hasCCard', 'cCardType', 'totalDives', 'healthNotes', 'guideNotes', 'registeredAt',
  'updatedAt', 'birthDate', 'gender', 'postalCode', 'address', 'emergencyName', 'emergencyRelation',
  'emergencyPhone', 'cCardOrg', 'lastDiveDate', 'lastDivePeriod', 'dmConsent',
]

const DATE_TIME_FIELDS = new Set([
  'createdAt', 'updatedAt', 'questionnaireTokenExpiresAt', 'submittedAt', 'consentAt', 'qrExpiresAt', 'registeredAt',
])

function columnName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function timestampValue(field: string, value: unknown): unknown {
  if (DATE_TIME_FIELDS.has(field) && value === '') return null
  return value
}

function dbEntries<T extends object>(entity: T, fields: readonly string[], includeUndefined = false) {
  return fields.flatMap((field) => {
    if (!Object.prototype.hasOwnProperty.call(entity, field)) return []
    const value = (entity as Record<string, unknown>)[field]
    if (value === undefined && !includeUndefined) return []
    return [[columnName(field), value === undefined ? null : timestampValue(field, value)] as const]
  })
}

function insertSql(table: string, entries: readonly (readonly [string, unknown])[]): { sql: string; values: unknown[] } {
  const columns = entries.map(([column]) => column)
  const values = entries.map(([, value]) => value)
  const placeholders = values.map((_, index) => `$${index + 1}`)
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values,
  }
}

async function insertEntity(
  client: PoolClient,
  table: string,
  entityType: EntityType,
  entity: object,
  fields: readonly string[],
): Promise<void> {
  const entries = dbEntries(entity, fields)
  const statement = insertSql(table, entries)
  await client.query(statement.sql, statement.values)
  await enqueueSheets(client, entityType, String((entity as { id: string }).id), 'upsert')
}

async function updateEntity(
  client: PoolClient,
  table: string,
  entityType: EntityType,
  id: string,
  entity: object,
  fields: readonly string[],
  changedFields: object = entity,
): Promise<void> {
  const entries = dbEntries(changedFields, fields, true)
    .filter(([column]) => column !== 'id' && column !== 'updated_at')
  if (!entries.length) {
    const result = await client.query(`UPDATE ${table} SET updated_at = now() WHERE id = $1 RETURNING id`, [id])
    if (!result.rowCount) throw new Error(`${entityType} ${id} not found`)
    await enqueueSheets(client, entityType, id, 'upsert')
    return
  }
  const assignments = entries.map(([column], index) => `${column} = $${index + 1}`)
  assignments.push('updated_at = now()')
  const values = entries.map(([, value]) => value)
  values.push(id)
  const result = await client.query(
    `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING id`,
    values,
  )
  if (!result.rowCount) throw new Error(`${entityType} ${id} not found`)
  await enqueueSheets(client, entityType, id, 'upsert')
}

async function enqueueSheets(
  client: PoolClient,
  entityType: EntityType,
  entityId: string,
  operation: 'upsert' | 'delete',
): Promise<void> {
  await client.query(
    `INSERT INTO sheets_outbox (entity_type, entity_id, operation)
     VALUES ($1, $2, $3)`,
    [entityType, entityId, operation],
  )
}

function stringValue(row: Row, key: string, fallback = ''): string {
  const value = row[key]
  return value === null || value === undefined ? fallback : String(value)
}

function optionalString(row: Row, key: string): string | undefined {
  const value = row[key]
  return value === null || value === undefined || value === '' ? undefined : String(value)
}

function dateTimeString(row: Row, key: string): string | undefined {
  const value = row[key]
  if (value === null || value === undefined || value === '') return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function booleanValue(row: Row, key: string): boolean {
  return row[key] === true || row[key] === 'true'
}

function numberValue(row: Row, key: string, fallback = 0): number {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : fallback
}

function nullableNumberValue(row: Row, key: string): number | null {
  if (row[key] === null || row[key] === undefined || row[key] === '') return null
  const value = Number(row[key])
  return Number.isFinite(value) ? value : null
}

function mapReservation(row: Row): Reservation {
  return {
    id: stringValue(row, 'id'),
    createdAt: dateTimeString(row, 'created_at'),
    updatedAt: dateTimeString(row, 'updated_at'),
    customerId: optionalString(row, 'customer_id'),
    guestName: stringValue(row, 'guest_name'),
    guestPhone: stringValue(row, 'guest_phone'),
    guestEmail: optionalString(row, 'guest_email'),
    diveDate: stringValue(row, 'dive_date'),
    time: optionalString(row, 'time'),
    timeSlot: stringValue(row, 'time_slot', 'unspecified') as Reservation['timeSlot'],
    courseId: optionalString(row, 'course_id'),
    courseName: stringValue(row, 'course_name'),
    guestCount: numberValue(row, 'guest_count', 1),
    status: stringValue(row, 'status'),
    staffId: optionalString(row, 'staff_id'),
    staffName: optionalString(row, 'staff_name'),
    channel: stringValue(row, 'channel', 'hp') as Reservation['channel'],
    questionnaireId: optionalString(row, 'questionnaire_id'),
    questionnaireIds: optionalString(row, 'questionnaire_ids'),
    questionnaireToken: optionalString(row, 'questionnaire_token'),
    questionnaireTokenExpiresAt: dateTimeString(row, 'questionnaire_token_expires_at'),
    questionnaireCompleted: booleanValue(row, 'questionnaire_completed'),
    divePoint: optionalString(row, 'dive_point'),
    staffNote: optionalString(row, 'staff_note'),
  }
}

function mapQuestionnaire(row: Row): QuestionnaireData {
  return {
    id: stringValue(row, 'id'),
    reservationId: stringValue(row, 'reservation_id'),
    submittedAt: dateTimeString(row, 'submitted_at') ?? '',
    customerId: optionalString(row, 'customer_id'),
    submissionId: optionalString(row, 'submission_id'),
    lastName: stringValue(row, 'last_name'),
    firstName: stringValue(row, 'first_name'),
    lastNameKana: stringValue(row, 'last_name_kana'),
    firstNameKana: stringValue(row, 'first_name_kana'),
    birthDate: stringValue(row, 'birth_date'),
    gender: stringValue(row, 'gender') as QuestionnaireData['gender'],
    postalCode: optionalString(row, 'postal_code'),
    address: stringValue(row, 'address'),
    phone: stringValue(row, 'phone'),
    email: optionalString(row, 'email'),
    emergencyName: stringValue(row, 'emergency_name'),
    emergencyRelation: stringValue(row, 'emergency_relation'),
    emergencyPhone: stringValue(row, 'emergency_phone'),
    heartDisease: booleanValue(row, 'heart_disease'),
    highBloodPressure: booleanValue(row, 'high_blood_pressure'),
    respiratoryDisease: booleanValue(row, 'respiratory_disease'),
    earDisease: booleanValue(row, 'ear_disease'),
    epilepsy: booleanValue(row, 'epilepsy'),
    diabetes: booleanValue(row, 'diabetes'),
    pregnant: booleanValue(row, 'pregnant'),
    panicDisorder: booleanValue(row, 'panic_disorder'),
    medication: booleanValue(row, 'medication'),
    medicationName: stringValue(row, 'medication_name'),
    latexAllergy: booleanValue(row, 'latex_allergy'),
    sleepHours: nullableNumberValue(row, 'sleep_hours'),
    sleepCategory: optionalString(row, 'sleep_category'),
    alcoholLastNight: booleanValue(row, 'alcohol_last_night'),
    alcoholToday: booleanValue(row, 'alcohol_today'),
    condition: stringValue(row, 'condition') as QuestionnaireData['condition'],
    conditionDetails: optionalString(row, 'condition_details'),
    flightWithin48h: booleanValue(row, 'flight_within_48h'),
    hasCCard: booleanValue(row, 'has_c_card'),
    cCardType: stringValue(row, 'c_card_type'),
    cCardOrg: stringValue(row, 'c_card_org'),
    lastDiveDate: stringValue(row, 'last_dive_date'),
    lastDivePeriod: optionalString(row, 'last_dive_period'),
    totalDives: nullableNumberValue(row, 'total_dives'),
    agreeRisk: booleanValue(row, 'agree_risk'),
    agreeMedical: booleanValue(row, 'agree_medical'),
    agreePhoto: booleanValue(row, 'agree_photo'),
    consentAt: dateTimeString(row, 'consent_at'),
    qrToken: optionalString(row, 'qr_token'),
    qrExpiresAt: dateTimeString(row, 'qr_expires_at'),
    qrUsed: booleanValue(row, 'qr_used'),
    doctorDivingPermit: optionalString(row, 'doctor_diving_permit'),
    doctorClearance: optionalString(row, 'doctor_clearance') as QuestionnaireData['doctorClearance'],
    medicalCertificate: booleanValue(row, 'medical_certificate'),
    staffReviewStatus: optionalString(row, 'staff_review_status'),
    staffReviewNotes: optionalString(row, 'staff_review_notes'),
    staffCheckStatus: optionalString(row, 'staff_check_status') as QuestionnaireData['staffCheckStatus'],
    staffCheckNote: optionalString(row, 'staff_check_note'),
    submissionState: optionalString(row, 'submission_state') as QuestionnaireData['submissionState'],
  }
}

function mapCustomer(row: Row): Customer {
  return {
    id: stringValue(row, 'id'),
    lastName: stringValue(row, 'last_name'),
    firstName: stringValue(row, 'first_name'),
    lastNameKana: stringValue(row, 'last_name_kana'),
    firstNameKana: stringValue(row, 'first_name_kana'),
    phone: stringValue(row, 'phone'),
    email: stringValue(row, 'email'),
    lastVisit: stringValue(row, 'last_visit'),
    visitCount: numberValue(row, 'visit_count'),
    hasCCard: booleanValue(row, 'has_c_card'),
    cCardType: stringValue(row, 'c_card_type'),
    totalDives: nullableNumberValue(row, 'total_dives'),
    healthNotes: stringValue(row, 'health_notes'),
    guideNotes: stringValue(row, 'guide_notes'),
    registeredAt: dateTimeString(row, 'registered_at'),
    updatedAt: dateTimeString(row, 'updated_at'),
    countedReservationIds: stringValue(row, 'counted_reservation_ids', '[]'),
    birthDate: optionalString(row, 'birth_date'),
    gender: optionalString(row, 'gender') as Customer['gender'],
    postalCode: optionalString(row, 'postal_code'),
    address: optionalString(row, 'address'),
    emergencyName: optionalString(row, 'emergency_name'),
    emergencyRelation: optionalString(row, 'emergency_relation'),
    emergencyPhone: optionalString(row, 'emergency_phone'),
    cCardOrg: optionalString(row, 'c_card_org'),
    lastDiveDate: optionalString(row, 'last_dive_date'),
    lastDivePeriod: optionalString(row, 'last_dive_period'),
    dmConsent: optionalString(row, 'dm_consent'),
  }
}

function mapRosterEntry(row: Row): RosterEntry {
  return {
    id: stringValue(row, 'id'),
    diveDate: stringValue(row, 'dive_date'),
    reservationId: stringValue(row, 'reservation_id'),
    questionnaireId: stringValue(row, 'questionnaire_id'),
    customerId: optionalString(row, 'customer_id') ?? '',
    name: stringValue(row, 'name'),
    nameKana: stringValue(row, 'name_kana'),
    birthDate: stringValue(row, 'birth_date'),
    age: numberValue(row, 'age'),
    gender: stringValue(row, 'gender'),
    address: stringValue(row, 'address'),
    phone: stringValue(row, 'phone'),
    emergencyContact: stringValue(row, 'emergency_contact'),
    emergencyPhone: stringValue(row, 'emergency_phone'),
    course: stringValue(row, 'course'),
    staffName: stringValue(row, 'staff_name'),
    checkedInAt: dateTimeString(row, 'checked_in_at') ?? '',
    checkInMethod: stringValue(row, 'check_in_method') as RosterEntry['checkInMethod'],
  }
}

const CUSTOMER_COUNT_SELECT = `
  COALESCE((
    SELECT json_agg(marker.reservation_id ORDER BY marker.counted_at)::text
    FROM customer_reservation_counts marker
    WHERE marker.customer_id = customers.id
  ), '[]') AS counted_reservation_ids
`

async function readCustomer(client: PoolClient, id: string, lock = false): Promise<Customer | undefined> {
  const result = await client.query(
    `SELECT customers.*, ${CUSTOMER_COUNT_SELECT} FROM customers WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return result.rows[0] ? mapCustomer(result.rows[0]) : undefined
}

function parseIdList(value?: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function syncCustomerMarkers(client: PoolClient, customerId: string, reservationIds: string[]): Promise<void> {
  await client.query('DELETE FROM customer_reservation_counts WHERE customer_id = $1', [customerId])
  if (reservationIds.length) {
    await client.query(
      `INSERT INTO customer_reservation_counts (customer_id, reservation_id)
       SELECT $1, candidates.reservation_id
       FROM unnest($2::text[]) AS candidates(reservation_id)
       JOIN reservations ON reservations.id = candidates.reservation_id
       ON CONFLICT DO NOTHING`,
      [customerId, reservationIds],
    )
  }
}

async function linkQuestionnaire(client: PoolClient, questionnaire: QuestionnaireData): Promise<Reservation> {
  const result = await client.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [questionnaire.reservationId])
  if (!result.rows[0]) throw new Error(`Reservation ${questionnaire.reservationId} not found`)
  const reservation = mapReservation(result.rows[0])
  const linked = await client.query(
    'SELECT id FROM questionnaires WHERE reservation_id = $1 ORDER BY submitted_at, id',
    [questionnaire.reservationId],
  )
  const ids = new Set<string>([
    ...(reservation.questionnaireIds ?? '').split('|').filter(Boolean),
    ...linked.rows.map((row) => String(row.id)),
    questionnaire.id,
  ])
  const updated: Reservation = {
    ...reservation,
    questionnaireId: questionnaire.id,
    questionnaireIds: Array.from(ids).join('|'),
    questionnaireCompleted: true,
    updatedAt: new Date().toISOString(),
  }
  await client.query(
    `UPDATE reservations SET questionnaire_id = $1, questionnaire_ids = $2,
       questionnaire_completed = true, updated_at = now() WHERE id = $3`,
    [updated.questionnaireId, updated.questionnaireIds, updated.id],
  )
  await enqueueSheets(client, 'reservation', updated.id, 'upsert')
  return updated
}

async function allocateQuestionnaireId(client: PoolClient): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('umibudou:questionnaire-id'), hashtext('allocator'))")
  const result = await client.query('SELECT id FROM questionnaires')
  return nextQuestionnaireId(result.rows.map((row) => ({ id: String(row.id) }) as QuestionnaireData))
}

async function allocateCustomerId(client: PoolClient): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('umibudou:customer-id'), hashtext('allocator'))")
  const result = await client.query('SELECT id FROM customers')
  return nextCustomerId(result.rows.map((row) => String(row.id)))
}

async function insertCountMarker(client: PoolClient, customerId: string, reservationId: string): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO customer_reservation_counts (customer_id, reservation_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING reservation_id`,
    [customerId, reservationId],
  )
  return Boolean(result.rowCount)
}

function healthSummary(questionnaire: QuestionnaireData): string {
  return [
    questionnaire.heartDisease && '心臓疾患',
    questionnaire.highBloodPressure && '高血圧',
    questionnaire.respiratoryDisease && '呼吸器疾患',
    questionnaire.earDisease && '耳の疾患',
    questionnaire.epilepsy && 'てんかん',
    questionnaire.diabetes && '糖尿病',
    questionnaire.pregnant && '妊娠中',
    questionnaire.panicDisorder && 'パニック障害',
    questionnaire.medication && `服薬：${questionnaire.medicationName}`,
    questionnaire.latexAllergy && 'ラテックスアレルギー',
  ].filter(Boolean).join('、') || '特記なし'
}

function normalizedPhone(value: string): string {
  return value.normalize('NFKC').replace(/\D/g, '')
}

async function lockCustomerIdentity(client: PoolClient, form: QuestionnaireFormData): Promise<void> {
  const email = (form.email ?? '').trim().toLocaleLowerCase('ja-JP')
  const phoneIdentity = `${normalizedPhone(form.phone)}:${form.lastName}:${form.firstName}`
  const keys = [email && `email:${email}`, `phone:${phoneIdentity}`].filter((key): key is string => Boolean(key)).sort()
  for (const key of keys) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('umibudou:customer-identity'), hashtext($1))", [key])
  }
}

async function findPublicIdentityConflict(client: PoolClient, form: QuestionnaireFormData): Promise<boolean> {
  const email = (form.email ?? '').trim().toLocaleLowerCase('ja-JP')
  if (email) {
    const byEmail = await client.query(
      "SELECT id FROM customers WHERE lower(btrim(email)) = $1 ORDER BY id LIMIT 1 FOR UPDATE",
      [email],
    )
    if (byEmail.rowCount) return true
  }

  const candidates = await client.query(
    `SELECT id, phone FROM customers
     WHERE btrim(email) = '' AND last_name = $1 AND first_name = $2
     ORDER BY id FOR UPDATE`,
    [form.lastName, form.firstName],
  )
  return candidates.rows.some((row) => normalizedPhone(String(row.phone ?? '')) === normalizedPhone(form.phone))
}

function questionnaireForInsert(
  input: PublicQuestionnaireSubmission | StaffQuestionnaireSubmission,
  reservation: Reservation,
  customerId: string | undefined,
  requiresStaffReview: boolean,
): Omit<QuestionnaireData, 'id'> {
  const submittedAt = new Date().toISOString()
  return {
    ...input.formData,
    reservationId: input.reservationId,
    submittedAt,
    customerId,
    submissionId: input.submissionId,
    email: input.formData.email ?? '',
    postalCode: input.formData.postalCode ?? '',
    highBloodPressure: input.formData.highBloodPressure ?? false,
    conditionDetails: input.formData.conditionDetails ?? '',
    sleepHours: input.formData.sleepHours ?? null,
    sleepCategory: input.formData.sleepCategory ?? '',
    lastDivePeriod: input.formData.lastDivePeriod ?? input.formData.lastDiveDate,
    medicalCertificate: input.formData.medicalCertificate ?? false,
    consentAt: submittedAt,
    qrToken: randomBytes(16).toString('base64url'),
    qrExpiresAt: questionnaireTokenExpiryForDiveDate(reservation.diveDate),
    qrUsed: false,
    doctorDivingPermit: '',
    doctorClearance: '',
    staffCheckStatus: '未確認',
    staffCheckNote: '',
    staffReviewStatus: requiresStaffReview ? '要対応' : '未確認',
    staffReviewNotes: requiresStaffReview
      ? '既存顧客情報と一致しました。本人確認後に顧客台帳へ反映してください。'
      : '',
    submissionState: 'complete',
  }
}

async function createPublicCustomer(
  client: PoolClient,
  questionnaire: QuestionnaireData,
  reservationId: string,
): Promise<Customer> {
  const id = await allocateCustomerId(client)
  const customer: Customer = {
    id,
    lastName: questionnaire.lastName,
    firstName: questionnaire.firstName,
    lastNameKana: questionnaire.lastNameKana,
    firstNameKana: questionnaire.firstNameKana,
    phone: questionnaire.phone,
    email: questionnaire.email ?? '',
    lastVisit: questionnaire.submittedAt.slice(0, 10),
    visitCount: 1,
    countedReservationIds: JSON.stringify([reservationId]),
    hasCCard: questionnaire.hasCCard,
    cCardType: questionnaire.cCardType,
    totalDives: questionnaire.totalDives,
    healthNotes: healthSummary(questionnaire),
    guideNotes: '',
    registeredAt: questionnaire.submittedAt,
    updatedAt: questionnaire.submittedAt,
    birthDate: questionnaire.birthDate,
    gender: questionnaire.gender,
    postalCode: questionnaire.postalCode ?? '',
    address: questionnaire.address,
    emergencyName: questionnaire.emergencyName,
    emergencyRelation: questionnaire.emergencyRelation,
    emergencyPhone: questionnaire.emergencyPhone,
    cCardOrg: questionnaire.cCardOrg,
    lastDivePeriod: questionnaire.lastDivePeriod || questionnaire.lastDiveDate,
    dmConsent: '',
  }
  await insertEntity(client, 'customers', 'customer', customer, CUSTOMER_FIELDS as readonly string[])
  await insertCountMarker(client, id, reservationId)
  return customer
}

export async function getReservations(): Promise<Reservation[]> {
  const result = await query('SELECT * FROM reservations ORDER BY dive_date, time, id')
  return result.rows.map(mapReservation)
}

export async function addReservation(input: ReservationInput): Promise<Reservation> {
  const normalized = normalizeReservationInput(input)
  const reservation: Reservation = {
    ...normalized,
    questionnaireToken: normalized.questionnaireToken ?? createReservationQuestionnaireToken(),
    questionnaireTokenExpiresAt: normalized.questionnaireTokenExpiresAt ?? questionnaireTokenExpiryForDiveDate(normalized.diveDate),
  }
  await withTransaction(async (client) => {
    await insertEntity(client, 'reservations', 'reservation', reservation, RESERVATION_FIELDS as readonly string[])
  })
  return reservation
}

export async function updateReservation(id: string, input: ReservationInput): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [id])
    if (!result.rows[0]) throw new Error(`Reservation ${id} not found`)
    const existing = mapReservation(result.rows[0])
    const patch = normalizeReservationPatch(input)
    const updatedAt = new Date().toISOString()
    const updated = { ...existing, ...patch, updatedAt }
    if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
      updated.questionnaireTokenExpiresAt = questionnaireTokenExpiryForDiveDate(updated.diveDate)
    }
    const changes = { ...patch, updatedAt }
    if (patch.diveDate !== undefined && patch.questionnaireTokenExpiresAt == null) {
      changes.questionnaireTokenExpiresAt = updated.questionnaireTokenExpiresAt
    }
    await updateEntity(client, 'reservations', 'reservation', id, updated, RESERVATION_FIELDS as readonly string[], changes)
  })
}

export async function getQuestionnaires(): Promise<QuestionnaireData[]> {
  const result = await query('SELECT * FROM questionnaires ORDER BY submitted_at, id')
  return result.rows.map(mapQuestionnaire)
}

export async function addQuestionnaire(data: Omit<QuestionnaireData, 'id'>): Promise<QuestionnaireData> {
  return withTransaction(async (client) => {
    const questionnaire: QuestionnaireData = {
      submissionState: 'complete',
      ...data,
      id: await allocateQuestionnaireId(client),
    }
    await insertEntity(client, 'questionnaires', 'questionnaire', questionnaire, QUESTIONNAIRE_FIELDS as readonly string[])
    await linkQuestionnaire(client, questionnaire)
    return questionnaire
  })
}

export async function searchQuestionnaires(search: string): Promise<QuestionnaireData[]> {
  const all = await getQuestionnaires()
  return all.filter((questionnaire) => matchesQuestionnaire(questionnaire, search))
}

export async function getQuestionnaireById(id: string): Promise<QuestionnaireData | undefined> {
  const result = await query('SELECT * FROM questionnaires WHERE id = $1', [id])
  return result.rows[0] ? mapQuestionnaire(result.rows[0]) : undefined
}

export async function updateQuestionnaire(
  id: string,
  data: Partial<QuestionnaireData>,
): Promise<QuestionnaireData> {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM questionnaires WHERE id = $1 FOR UPDATE', [id])
    if (!result.rows[0]) throw new Error(`Questionnaire ${id} not found`)
    const updated: QuestionnaireData = { ...mapQuestionnaire(result.rows[0]), ...data, id }
    await updateEntity(client, 'questionnaires', 'questionnaire', id, updated, QUESTIONNAIRE_FIELDS as readonly string[], data)
    return updated
  })
}

export async function getCustomers(): Promise<Customer[]> {
  const result = await query(`SELECT customers.*, ${CUSTOMER_COUNT_SELECT} FROM customers ORDER BY id`)
  return result.rows.map(mapCustomer)
}

export async function searchCustomers(search: string): Promise<Customer[]> {
  return (await getCustomers()).filter((customer) => matchesCustomer(customer, search))
}

export async function getRoster(): Promise<RosterEntry[]> {
  const result = await query('SELECT * FROM roster_entries ORDER BY checked_in_at DESC, id')
  return result.rows.map(mapRosterEntry)
}

export async function addRoster(data: RosterEntry): Promise<RosterEntry> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO roster_entries (
        id, dive_date, reservation_id, questionnaire_id, customer_id, name, name_kana,
        birth_date, age, gender, address, phone, emergency_contact, emergency_phone,
        course, staff_name, checked_in_at, check_in_method
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      ) ON CONFLICT (questionnaire_id) DO NOTHING RETURNING *`,
      [
        data.id,
        data.diveDate,
        data.reservationId,
        data.questionnaireId,
        data.customerId || null,
        data.name,
        data.nameKana,
        data.birthDate,
        data.age,
        data.gender,
        data.address,
        data.phone,
        data.emergencyContact,
        data.emergencyPhone,
        data.course,
        data.staffName,
        data.checkedInAt,
        data.checkInMethod,
      ],
    )
    if (result.rows[0]) {
      await enqueueSheets(client, 'roster', String(result.rows[0].id), 'upsert')
      return mapRosterEntry(result.rows[0])
    }
    const existing = await client.query(
      'SELECT * FROM roster_entries WHERE questionnaire_id = $1',
      [data.questionnaireId],
    )
    if (!existing.rows[0]) throw new Error('Failed to save roster entry')
    return mapRosterEntry(existing.rows[0])
  })
}

export async function addCustomer(data: Customer): Promise<void> {
  await withTransaction(async (client) => {
    await insertEntity(client, 'customers', 'customer', data, CUSTOMER_FIELDS as readonly string[])
    await syncCustomerMarkers(client, data.id, parseIdList(data.countedReservationIds))
  })
}

export async function updateCustomer(id: string, data: Partial<Customer>): Promise<void> {
  await withTransaction(async (client) => {
    const existing = await readCustomer(client, id, true)
    if (!existing) throw new Error(`Customer ${id} not found`)
    const updated: Customer = { ...existing, ...data, updatedAt: new Date().toISOString() }
    await updateEntity(client, 'customers', 'customer', id, updated, CUSTOMER_FIELDS as readonly string[], {
      ...data,
      updatedAt: updated.updatedAt,
    })
    if (data.countedReservationIds !== undefined) {
      await syncCustomerMarkers(client, id, parseIdList(data.countedReservationIds))
    }
  })
}

async function submitQuestionnaire(
  input: PublicQuestionnaireSubmission | StaffQuestionnaireSubmission,
): Promise<PublicQuestionnaireSubmissionResult> {
  const isPublicSubmission = 'reservationToken' in input
  return withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('umibudou:questionnaire-submission'), hashtext($1))",
      [input.submissionId],
    )
    const priorResult = await client.query(
      'SELECT * FROM questionnaires WHERE submission_id = $1 FOR UPDATE',
      [input.submissionId],
    )
    const prior = priorResult.rows[0] ? mapQuestionnaire(priorResult.rows[0]) : undefined
    if (prior && prior.reservationId !== input.reservationId) {
      throw new DataStoreError('submission_conflict')
    }

    const reservationResult = await client.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [input.reservationId])
    if (!reservationResult.rows[0]) throw new DataStoreError('reservation_not_found')
    const reservation = mapReservation(reservationResult.rows[0])
    // Recheck cancellation after acquiring the reservation row lock so a concurrent
    // cancellation that committed after the API precheck cannot accept a new submission.
    if (!isQuestionnaireReservationAllowed(reservation.status)) {
      throw new DataStoreError('reservation_not_found')
    }
    if (
      isPublicSubmission &&
      (!reservation.questionnaireToken || reservation.questionnaireToken !== input.reservationToken)
    ) {
      throw new DataStoreError('reservation_not_found')
    }

    // A matching immutable submission may be retried after expiry. New submissions may not.
    if (prior) {
      return {
        status: 'replayed',
        questionnaire: prior,
        requiresStaffReview: prior.staffReviewStatus === '要対応',
      }
    }
    if (isPublicSubmission) {
      const expiry = reservation.questionnaireTokenExpiresAt ? new Date(reservation.questionnaireTokenExpiresAt) : null
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        throw new DataStoreError('questionnaire_expired')
      }
    }

    await lockCustomerIdentity(client, input.formData)
    const requiresStaffReview = await findPublicIdentityConflict(client, input.formData)
    const questionnaireBase = questionnaireForInsert(input, reservation, undefined, requiresStaffReview)
    const questionnaire: QuestionnaireData = {
      ...questionnaireBase,
      id: await allocateQuestionnaireId(client),
    }

    let createdCustomer: Customer | undefined
    if (!requiresStaffReview) {
      createdCustomer = await createPublicCustomer(client, questionnaire, input.reservationId)
      questionnaire.customerId = createdCustomer.id
    }

    // Insert the final questionnaire only after the customer has been created so its FK is valid.
    await insertEntity(client, 'questionnaires', 'questionnaire', questionnaire, QUESTIONNAIRE_FIELDS as readonly string[])
    await linkQuestionnaire(client, questionnaire)

    return {
      status: 'saved',
      questionnaire,
      requiresStaffReview,
    }
  })
}

export async function submitPublicQuestionnaire(
  input: PublicQuestionnaireSubmission,
): Promise<PublicQuestionnaireSubmissionResult> {
  return submitQuestionnaire(input)
}

export async function submitStaffQuestionnaire(
  input: StaffQuestionnaireSubmission,
): Promise<PublicQuestionnaireSubmissionResult> {
  return submitQuestionnaire(input)
}

export async function resolveQuestionnaireForCustomer(
  questionnaireId: string,
  customerId: string,
): Promise<QuestionnaireResolutionResult> {
  return withTransaction(async (client) => {
    const questionnaireResult = await client.query('SELECT * FROM questionnaires WHERE id = $1 FOR UPDATE', [questionnaireId])
    if (!questionnaireResult.rows[0]) return { status: 'not_found' }
    const questionnaire = mapQuestionnaire(questionnaireResult.rows[0])
    if (questionnaire.customerId && questionnaire.customerId !== customerId) return { status: 'customer_conflict' }
    if (questionnaire.customerId === customerId && questionnaire.staffReviewStatus !== '要対応') {
      return { status: 'resolved', questionnaire }
    }
    if (questionnaire.staffReviewStatus !== '要対応') return { status: 'not_pending' }

    const customer = await readCustomer(client, customerId, true)
    if (!customer) return { status: 'customer_not_found' }
    const notes = `本人確認済み。顧客ID ${customerId} へ反映しました。`
    const updateResult = await client.query(
      `UPDATE questionnaires SET customer_id = $1, staff_review_status = '確認済',
         staff_review_notes = $2, updated_at = now()
       WHERE id = $3 AND staff_review_status = '要対応'
         AND (customer_id IS NULL OR customer_id = $1)
       RETURNING *`,
      [customerId, notes, questionnaireId],
    )
    if (!updateResult.rows[0]) return { status: 'not_pending' }

    const visitCounted = await insertCountMarker(client, customerId, questionnaire.reservationId)
    const visitDate = questionnaire.submittedAt.slice(0, 10)
    const resolvedCustomer: Customer = {
      ...customer,
      lastName: questionnaire.lastName,
      firstName: questionnaire.firstName,
      lastNameKana: questionnaire.lastNameKana,
      firstNameKana: questionnaire.firstNameKana,
      birthDate: questionnaire.birthDate,
      gender: questionnaire.gender,
      postalCode: questionnaire.postalCode,
      address: questionnaire.address,
      phone: questionnaire.phone,
      email: questionnaire.email ?? customer.email,
      emergencyName: questionnaire.emergencyName,
      emergencyRelation: questionnaire.emergencyRelation,
      emergencyPhone: questionnaire.emergencyPhone,
      healthNotes: healthSummary(questionnaire),
      hasCCard: questionnaire.hasCCard,
      cCardType: questionnaire.cCardType,
      cCardOrg: questionnaire.cCardOrg,
      totalDives: questionnaire.totalDives,
      lastDivePeriod: questionnaire.lastDivePeriod || questionnaire.lastDiveDate,
      visitCount: customer.visitCount + (visitCounted ? 1 : 0),
      lastVisit: customer.lastVisit > visitDate ? customer.lastVisit : visitDate,
      updatedAt: new Date().toISOString(),
      countedReservationIds: JSON.stringify([
        ...Array.from(new Set([...parseIdList(customer.countedReservationIds), questionnaire.reservationId])),
      ]),
    }
    await updateEntity(client, 'customers', 'customer', customerId, resolvedCustomer, CUSTOMER_FIELDS as readonly string[])
    const resolvedQuestionnaire = mapQuestionnaire(updateResult.rows[0])
    await enqueueSheets(client, 'questionnaire', questionnaireId, 'upsert')
    return { status: 'resolved', questionnaire: resolvedQuestionnaire }
  })
}

async function loadLatestSheetsProjection(
  client: PoolClient,
  entityType: EntityType,
  entityId: string,
  lock: boolean,
): Promise<Customer | Reservation | QuestionnaireData | RosterEntry | undefined> {
  if (entityType === 'customer') return readCustomer(client, entityId, lock)
  if (entityType === 'roster') {
    const result = await client.query(
      `SELECT * FROM roster_entries WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [entityId],
    )
    return result.rows[0] ? mapRosterEntry(result.rows[0]) : undefined
  }
  if (entityType === 'reservation') {
    const result = await client.query(
      `SELECT * FROM reservations WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [entityId],
    )
    return result.rows[0] ? mapReservation(result.rows[0]) : undefined
  }

  const result = await client.query(
    `SELECT * FROM questionnaires WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [entityId],
  )
  return result.rows[0] ? mapQuestionnaire(result.rows[0]) : undefined
}

/** Load the canonical row when an outbox reference is dispatched. */
export async function getLatestSheetsProjection(
  entityType: EntityType,
  entityId: string,
): Promise<Customer | Reservation | QuestionnaireData | RosterEntry | undefined> {
  return withTransaction((client) => loadLatestSheetsProjection(client, entityType, entityId, false))
}

/** Re-enqueue only the current row reference after an outbox lease was lost. */
export async function requeueLatestSheetsProjection(
  entityType: EntityType,
  entityId: string,
): Promise<boolean> {
  return withTransaction(async (client) => {
    const projection = await loadLatestSheetsProjection(client, entityType, entityId, true)
    if (!projection) return false
    await enqueueSheets(client, entityType, entityId, 'upsert')
    return true
  })
}
