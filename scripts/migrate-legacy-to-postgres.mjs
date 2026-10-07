import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import nextEnv from '@next/env'
import { google } from 'googleapis'
import pg from 'pg'

const { Client } = pg
const { loadEnvConfig } = nextEnv
const SHEETS = {
  reservations: '予約',
  questionnaires: '問診票',
  customers: '顧客台帳',
}
const RESERVATION_ALIASES = { date: 'diveDate', course: 'courseName', phone: 'guestPhone', notes: 'staffNote' }
const RESERVATION_COLUMNS = [
  'id', 'created_at', 'updated_at', 'customer_id', 'guest_name', 'guest_phone', 'guest_email',
  'dive_date', 'time', 'time_slot', 'course_id', 'course_name', 'guest_count', 'status', 'staff_id',
  'staff_name', 'channel', 'questionnaire_id', 'questionnaire_ids', 'questionnaire_token',
  'questionnaire_token_expires_at', 'questionnaire_completed', 'dive_point', 'staff_note', 'raw_legacy',
]
const QUESTIONNAIRE_COLUMNS = [
  'id', 'reservation_id', 'customer_id', 'submission_id', 'submitted_at', 'last_name', 'first_name',
  'last_name_kana', 'first_name_kana', 'birth_date', 'gender', 'postal_code', 'address', 'phone', 'email',
  'emergency_name', 'emergency_relation', 'emergency_phone', 'heart_disease', 'high_blood_pressure',
  'respiratory_disease', 'ear_disease', 'epilepsy', 'diabetes', 'pregnant', 'panic_disorder', 'medication',
  'medication_name', 'latex_allergy', 'sleep_hours', 'alcohol_last_night', 'alcohol_today', 'condition',
  'condition_details', 'flight_within_48h', 'has_c_card', 'c_card_type', 'c_card_org', 'last_dive_date',
  'total_dives', 'agree_risk', 'agree_medical', 'agree_photo', 'consent_at', 'qr_token', 'qr_expires_at',
  'qr_used', 'doctor_diving_permit', 'staff_review_status', 'staff_review_notes', 'raw_legacy',
]
const CUSTOMER_COLUMNS = [
  'id', 'last_name', 'first_name', 'last_name_kana', 'first_name_kana', 'phone', 'email', 'last_visit',
  'visit_count', 'has_c_card', 'c_card_type', 'total_dives', 'health_notes', 'guide_notes', 'registered_at',
  'updated_at', 'birth_date', 'gender', 'postal_code', 'address', 'emergency_name', 'emergency_relation',
  'emergency_phone', 'c_card_org', 'last_dive_date', 'last_dive_period', 'dm_consent', 'raw_legacy',
]

function parseArgs(args) {
  let source
  let apply = false
  for (const arg of args) {
    if (arg === '--apply') {
      if (apply) throw new Error('Duplicate --apply flag')
      apply = true
    } else if (arg.startsWith('--source=')) {
      if (source) throw new Error('Duplicate --source flag')
      source = arg.slice('--source='.length)
    } else {
      throw new Error('Usage: npm run db:import-legacy -- --source=json|sheets [--apply]')
    }
  }
  if (!['json', 'sheets'].includes(source)) {
    throw new Error('An explicit --source=json or --source=sheets is required')
  }
  return { source, apply }
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function rawText(value) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value.trim() : String(value).trim()
}

function optionalText(value) {
  if (value === null || value === undefined) return null
  const result = String(value)
  return result.trim() ? result : null
}

function requiredText(value, entity, id, field, issues) {
  const result = value === null || value === undefined ? '' : String(value)
  if (!result.trim()) issues.push({ entity, id: id || '<missing>', reason: `missing_${field}` })
  return result
}

function parseNumber(value, fallback, { entity, id, field, integer = false, minimum = 0 }, issues) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < minimum) {
    issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}` })
    return fallback
  }
  return parsed
}

function parseBoolean(value, { entity, id, field }, issues) {
  if (value === null || value === undefined || value === '') return false
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  const normalized = String(value).trim().toLocaleLowerCase('ja-JP')
  if (['true', '1', '済', '完了', 'yes', 'はい'].includes(normalized)) return true
  if (['false', '0', '未', 'no', 'いいえ'].includes(normalized)) return false
  issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}` })
  return false
}

function parseTimestamp(value, { entity, id, field, required = false }, issues) {
  const raw = rawText(value)
  if (!raw) {
    if (required) issues.push({ entity, id: id || '<missing>', reason: `missing_${field}` })
    return null
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}` })
    return null
  }
  return date.toISOString()
}

function parseDate(value, { entity, id, field, required = false }, issues) {
  const raw = rawText(value)
  if (!raw) {
    if (required) issues.push({ entity, id: id || '<missing>', reason: `missing_${field}` })
    return ''
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}` })
    return raw
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}` })
  }
  return raw
}

function parseList(value, { entity, id, field }, issues) {
  if (value === null || value === undefined || value === '') return []
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}_json` })
      return []
    }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    issues.push({ entity, id: id || '<missing>', reason: `invalid_${field}_list` })
    return []
  }
  return [...new Set(parsed.filter((item) => item.trim()))]
}

function canonicalReservation(source) {
  const result = { ...source }
  for (const [legacy, canonical] of Object.entries(RESERVATION_ALIASES)) {
    if (!rawText(result[canonical]) && rawText(result[legacy])) result[canonical] = result[legacy]
  }
  return result
}

function rawPayload(source, sourceKind) {
  return sourceKind === 'sheets' ? source.__rawSheetRow : source
}

export function buildRows(sourceRows, sourceKind, issues) {
  const rows = { customers: [], reservations: [], questionnaires: [] }
  const sourceByType = sourceKind === 'sheets'
    ? Object.fromEntries(Object.entries(sourceRows).map(([type, list]) => [type, list.map((entry) => entry.record)]))
    : sourceRows

  for (const [entity, rawRows] of Object.entries(sourceByType)) {
    const seenIds = new Set()
    for (const original of rawRows) {
      if (!isRecord(original)) {
        issues.push({ entity, id: '<missing>', reason: 'row_not_object' })
        continue
      }
      const source = entity === 'reservations' ? canonicalReservation(original) : original
      const id = requiredText(source.id, entity, '', 'id', issues)
      if (id && seenIds.has(id)) issues.push({ entity, id, reason: 'duplicate_source_id' })
      seenIds.add(id)
      const legacy = JSON.stringify(rawPayload(original, sourceKind) ?? original)

      if (entity === 'customers') {
        const timestampOptions = (field) => ({ entity, id, field })
        const row = {
          id,
          last_name: rawText(source.lastName),
          first_name: rawText(source.firstName),
          last_name_kana: rawText(source.lastNameKana),
          first_name_kana: rawText(source.firstNameKana),
          phone: rawText(source.phone),
          email: rawText(source.email),
          last_visit: rawText(source.lastVisit),
          visit_count: parseNumber(source.visitCount, 0, { entity, id, field: 'visitCount', integer: true }, issues),
          visit_count_source_known: source.visitCount !== undefined && source.visitCount !== null && String(source.visitCount).trim() !== '',
          has_c_card: parseBoolean(source.hasCCard, { entity, id, field: 'hasCCard' }, issues),
          c_card_type: rawText(source.cCardType),
          total_dives: parseNumber(source.totalDives, 0, { entity, id, field: 'totalDives', integer: true }, issues),
          health_notes: rawText(source.healthNotes),
          guide_notes: rawText(source.guideNotes),
          registered_at: parseTimestamp(source.registeredAt, timestampOptions('registeredAt'), issues),
          updated_at: parseTimestamp(source.updatedAt, timestampOptions('updatedAt'), issues),
          birth_date: rawText(source.birthDate),
          gender: rawText(source.gender) || 'undisclosed',
          postal_code: rawText(source.postalCode),
          address: rawText(source.address),
          emergency_name: rawText(source.emergencyName),
          emergency_relation: rawText(source.emergencyRelation),
          emergency_phone: rawText(source.emergencyPhone),
          c_card_org: rawText(source.cCardOrg),
          last_dive_date: rawText(source.lastDiveDate),
          last_dive_period: rawText(source.lastDivePeriod),
          dm_consent: rawText(source.dmConsent),
          raw_legacy: legacy,
          counted_reservation_ids: parseList(source.countedReservationIds, { entity, id, field: 'countedReservationIds' }, issues),
          counted_questionnaire_ids: parseList(source.countedQuestionnaireIds, { entity, id, field: 'countedQuestionnaireIds' }, issues),
        }
        rows.customers.push(row)
      } else if (entity === 'reservations') {
        const row = {
          id,
          created_at: parseTimestamp(source.createdAt, { entity, id, field: 'createdAt' }, issues),
          updated_at: parseTimestamp(source.updatedAt, { entity, id, field: 'updatedAt' }, issues),
          customer_id: optionalText(source.customerId),
          guest_name: rawText(source.guestName),
          guest_phone: rawText(source.guestPhone),
          guest_email: optionalText(source.guestEmail),
          dive_date: parseDate(source.diveDate, { entity, id, field: 'diveDate', required: true }, issues),
          time: rawText(source.time),
          time_slot: rawText(source.timeSlot) || 'unspecified',
          course_id: optionalText(source.courseId),
          course_name: rawText(source.courseName),
          guest_count: parseNumber(source.guestCount, 1, { entity, id, field: 'guestCount', integer: true }, issues),
          status: rawText(source.status) || 'STS-01',
          staff_id: optionalText(source.staffId),
          staff_name: optionalText(source.staffName),
          channel: rawText(source.channel) || 'hp',
          questionnaire_id: optionalText(source.questionnaireId),
          questionnaire_ids: rawText(source.questionnaireIds),
          questionnaire_token: optionalText(source.questionnaireToken),
          questionnaire_token_expires_at: parseTimestamp(source.questionnaireTokenExpiresAt, { entity, id, field: 'questionnaireTokenExpiresAt' }, issues),
          questionnaire_completed: parseBoolean(source.questionnaireCompleted, { entity, id, field: 'questionnaireCompleted' }, issues),
          dive_point: optionalText(source.divePoint),
          staff_note: optionalText(source.staffNote),
          raw_legacy: legacy,
        }
        rows.reservations.push(row)
      } else if (entity === 'questionnaires') {
        const timestamp = (field, required = false) => parseTimestamp(source[field], { entity, id, field, required }, issues)
        const bool = (field) => parseBoolean(source[field], { entity, id, field }, issues)
        const row = {
          id,
          reservation_id: requiredText(source.reservationId, entity, id, 'reservationId', issues),
          customer_id: optionalText(source.customerId),
          submission_id: optionalText(source.submissionId),
          submitted_at: timestamp('submittedAt', true),
          last_name: rawText(source.lastName),
          first_name: rawText(source.firstName),
          last_name_kana: rawText(source.lastNameKana),
          first_name_kana: rawText(source.firstNameKana),
          birth_date: rawText(source.birthDate),
          gender: rawText(source.gender),
          postal_code: rawText(source.postalCode),
          address: rawText(source.address),
          phone: rawText(source.phone),
          email: rawText(source.email),
          emergency_name: rawText(source.emergencyName),
          emergency_relation: rawText(source.emergencyRelation),
          emergency_phone: rawText(source.emergencyPhone),
          heart_disease: bool('heartDisease'),
          high_blood_pressure: bool('highBloodPressure'),
          respiratory_disease: bool('respiratoryDisease'),
          ear_disease: bool('earDisease'),
          epilepsy: bool('epilepsy'),
          diabetes: bool('diabetes'),
          pregnant: bool('pregnant'),
          panic_disorder: bool('panicDisorder'),
          medication: bool('medication'),
          medication_name: rawText(source.medicationName),
          latex_allergy: bool('latexAllergy'),
          sleep_hours: parseNumber(source.sleepHours, 0, { entity, id, field: 'sleepHours' }, issues),
          alcohol_last_night: bool('alcoholLastNight'),
          alcohol_today: bool('alcoholToday'),
          condition: rawText(source.condition),
          condition_details: rawText(source.conditionDetails),
          flight_within_48h: bool('flightWithin48h'),
          has_c_card: bool('hasCCard'),
          c_card_type: rawText(source.cCardType),
          c_card_org: rawText(source.cCardOrg),
          last_dive_date: rawText(source.lastDiveDate),
          total_dives: parseNumber(source.totalDives, 0, { entity, id, field: 'totalDives', integer: true }, issues),
          agree_risk: bool('agreeRisk'),
          agree_medical: bool('agreeMedical'),
          agree_photo: bool('agreePhoto'),
          consent_at: timestamp('consentAt'),
          qr_token: optionalText(source.qrToken),
          qr_expires_at: timestamp('qrExpiresAt'),
          qr_used: bool('qrUsed'),
          doctor_diving_permit: rawText(source.doctorDivingPermit),
          staff_review_status: rawText(source.staffReviewStatus),
          staff_review_notes: rawText(source.staffReviewNotes),
          raw_legacy: legacy,
        }
        rows.questionnaires.push(row)
      }
    }
  }

  return rows
}

function findDuplicates(rows, field, entity, issues, reason) {
  const seen = new Set()
  for (const row of rows) {
    const value = row[field]
    if (!value) continue
    if (seen.has(value)) issues.push({ entity, id: value, reason })
    seen.add(value)
  }
}

export function validateRelations(rows, issues, warnings) {
  const customerIds = new Set(rows.customers.map((row) => row.id).filter(Boolean))
  const reservationById = new Map(rows.reservations.filter((row) => row.id).map((row) => [row.id, row]))
  const questionnaireById = new Map(rows.questionnaires.filter((row) => row.id).map((row) => [row.id, row]))

  findDuplicates(rows.questionnaires, 'submission_id', 'questionnaires', issues, 'duplicate_submission_id')
  findDuplicates(rows.reservations, 'questionnaire_token', 'reservations', issues, 'duplicate_questionnaire_token')
  findDuplicates(rows.questionnaires, 'qr_token', 'questionnaires', issues, 'duplicate_qr_token')

  for (const reservation of rows.reservations) {
    if (reservation.customer_id && !customerIds.has(reservation.customer_id)) {
      issues.push({ entity: 'reservations', id: reservation.id, reason: 'missing_customer_reference' })
    }
    const links = new Set([
      reservation.questionnaire_id,
      ...reservation.questionnaire_ids.split('|').map((id) => id.trim()).filter(Boolean),
    ].filter(Boolean))
    for (const id of links) {
      const questionnaire = questionnaireById.get(id)
      if (!questionnaire) issues.push({ entity: 'reservations', id: reservation.id, reason: 'missing_questionnaire_reference' })
      else if (questionnaire.reservation_id !== reservation.id) {
        issues.push({ entity: 'reservations', id: reservation.id, reason: 'questionnaire_reservation_mismatch' })
      }
    }
  }

  for (const questionnaire of rows.questionnaires) {
    if (!reservationById.has(questionnaire.reservation_id)) {
      issues.push({ entity: 'questionnaires', id: questionnaire.id, reason: 'missing_reservation_reference' })
    }
    if (questionnaire.customer_id && !customerIds.has(questionnaire.customer_id)) {
      issues.push({ entity: 'questionnaires', id: questionnaire.id, reason: 'missing_customer_reference' })
    }
  }

  const questionnaireReservationById = new Map(rows.questionnaires.map((row) => [row.id, row.reservation_id]))
  const reservationIds = new Set(rows.reservations.map((row) => row.id).filter(Boolean))
  const questionnaireReservationsByCustomer = new Map()
  for (const questionnaire of rows.questionnaires) {
    const reservation = reservationById.get(questionnaire.reservation_id)
    if (!reservation) continue
    if (
      questionnaire.customer_id && reservation.customer_id &&
      questionnaire.customer_id !== reservation.customer_id
    ) {
      issues.push({
        entity: 'questionnaires',
        id: questionnaire.id,
        reason: 'questionnaire_reservation_customer_conflict',
      })
      continue
    }
    const linkedCustomerId = questionnaire.customer_id || reservation.customer_id
    if (!linkedCustomerId) continue
    const linked = questionnaireReservationsByCustomer.get(linkedCustomerId) ?? []
    linked.push(questionnaire.reservation_id)
    questionnaireReservationsByCustomer.set(linkedCustomerId, linked)
  }

  let inferredMarkerCount = 0
  for (const customer of rows.customers) {
    const markers = [...customer.counted_reservation_ids]
    for (const questionnaireId of customer.counted_questionnaire_ids) {
      const reservationId = questionnaireReservationById.get(questionnaireId)
      if (!reservationId) {
        issues.push({ entity: 'customers', id: customer.id, reason: 'missing_counted_questionnaire_reference' })
      } else markers.push(reservationId)
    }
    const linkedReservations = [...new Set(questionnaireReservationsByCustomer.get(customer.id) ?? [])]
    if (markers.length === 0 && customer.counted_questionnaire_ids.length === 0) {
      if (customer.visit_count > 0 && linkedReservations.length > 0) {
        markers.push(...linkedReservations)
        customer.inferred_count_marker_count = linkedReservations.length
        inferredMarkerCount += linkedReservations.length
      } else if (linkedReservations.length > 0) {
        warnings.push({
          entity: 'customers',
          id: customer.id,
          reason: customer.visit_count_source_known
            ? 'zero_visit_count_prevents_marker_inference'
            : 'unknown_visit_count_prevents_marker_inference',
        })
      } else if (customer.visit_count > 0) {
        warnings.push({ entity: 'customers', id: customer.id, reason: 'no_linked_questionnaire_for_marker_inference' })
      }
    }
    customer.count_markers = [...new Set(markers)]
    for (const reservationId of customer.count_markers) {
      if (!reservationIds.has(reservationId)) {
        issues.push({ entity: 'customers', id: customer.id, reason: 'missing_counted_reservation_reference' })
      }
    }
  }
  return inferredMarkerCount
}

function sheetQuote(name) {
  return `'${name.replace(/'/g, "''")}'`
}

async function readSheetsSource() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!spreadsheetId || !email || !privateKey) {
    throw new Error('Google Sheets credentials and spreadsheet ID are required for --source=sheets')
  }
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const result = {}
  for (const [entity, sheetName] of Object.entries(SHEETS)) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetQuote(sheetName)}!A1:AZ`,
    })
    const values = response.data.values ?? []
    const headers = (values[0] ?? []).map((header) => String(header ?? '').trim())
    if (!headers.length || !headers.includes('id')) throw new Error(`Missing headers or id column in ${sheetName}`)
    if (new Set(headers).size !== headers.length) throw new Error(`Duplicate headers in ${sheetName}`)
    const records = values.slice(1)
      .filter((cells) => cells.some((cell) => String(cell ?? '') !== ''))
      .map((cells, index) => {
        const record = Object.fromEntries(headers.map((header, column) => [header, String(cells[column] ?? '')]))
        record.__rawSheetRow = { source: 'sheets', sheet: sheetName, row: index + 2, headers, cells }
        return { record }
      })
    result[entity] = records
  }
  return result
}

async function readJsonSource() {
  const result = {}
  for (const entity of Object.keys(SHEETS)) {
    const file = path.join(process.cwd(), 'data', `${entity}.json`)
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`data/${entity}.json must contain a JSON array`)
    result[entity] = parsed
  }
  return result
}

function reportIssues(title, issues) {
  console.log(`${title}: ${issues.length}`)
  const counts = new Map()
  for (const issue of issues) counts.set(issue.reason, (counts.get(issue.reason) ?? 0) + 1)
  for (const [reason, count] of counts) console.log(`  ${reason}: ${count}`)
  for (const issue of issues.slice(0, 20)) {
    console.log(`  ${issue.entity} id=${issue.id}: ${issue.reason}`)
  }
  if (issues.length > 20) console.log(`  ... and ${issues.length - 20} more`)
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const TIMESTAMP_COLUMNS = new Set([
  'created_at', 'updated_at', 'registered_at', 'questionnaire_token_expires_at',
  'submitted_at', 'consent_at', 'qr_expires_at',
])

function sameImportedValue(column, expected, actual) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined
  if (column === 'raw_legacy') {
    try {
      return stableJson(JSON.parse(expected)) === stableJson(actual)
    } catch {
      return false
    }
  }
  if (TIMESTAMP_COLUMNS.has(column)) {
    const expectedTime = new Date(expected).getTime()
    const actualTime = new Date(actual).getTime()
    return Number.isFinite(expectedTime) && expectedTime === actualTime
  }
  if (typeof expected === 'number') return Number(actual) === expected
  if (typeof expected === 'boolean') return actual === expected
  return String(actual) === String(expected)
}

async function inspectTargetDatabase(client, rows) {
  const conflicts = []
  const databaseCounts = {}
  const tables = [
    ['customers', CUSTOMER_COLUMNS, rows.customers],
    ['reservations', RESERVATION_COLUMNS, rows.reservations],
    ['questionnaires', QUESTIONNAIRE_COLUMNS, rows.questionnaires],
  ]
  let empty = true
  let exact = true

  for (const [table, columns, sourceRows] of tables) {
    const result = await client.query(`SELECT ${columns.join(', ')} FROM ${table}`)
    databaseCounts[table] = result.rowCount ?? 0
    const expectedById = new Map(sourceRows.map((row) => [row.id, row]))
    if (result.rowCount) empty = false
    if (result.rowCount !== sourceRows.length) exact = false

    const foundIds = new Set()
    for (const actual of result.rows) {
      const expected = expectedById.get(actual.id)
      if (!expected) {
        exact = false
        conflicts.push({ entity: table, id: String(actual.id), reason: 'target_contains_unmatched_id' })
        continue
      }
      foundIds.add(actual.id)
      const differingColumns = columns.filter((column) => !sameImportedValue(column, expected[column], actual[column]))
      if (differingColumns.length) {
        exact = false
        conflicts.push({ entity: table, id: String(actual.id), reason: 'target_row_differs_from_source' })
      }
    }
    for (const source of sourceRows) {
      if (!foundIds.has(source.id) && result.rowCount) {
        exact = false
        conflicts.push({ entity: table, id: source.id, reason: 'target_missing_source_id' })
      }
    }
  }

  const expectedMarkers = rows.customers.flatMap((customer) =>
    customer.count_markers.map((reservationId) => `${customer.id}\0${reservationId}`),
  ).sort()
  const markerResult = await client.query(
    'SELECT customer_id, reservation_id FROM customer_reservation_counts',
  )
  databaseCounts.customer_reservation_counts = markerResult.rowCount ?? 0
  if (markerResult.rowCount) empty = false
  const actualMarkers = markerResult.rows
    .map((marker) => `${marker.customer_id}\0${marker.reservation_id}`)
    .sort()
  if (stableJson(actualMarkers) !== stableJson(expectedMarkers)) {
    exact = false
    conflicts.push({ entity: 'customer_reservation_counts', id: '-', reason: 'target_markers_differ_from_source' })
  }

  const outboxResult = await client.query('SELECT count(*)::integer AS count FROM sheets_outbox')
  const outboxCount = Number(outboxResult.rows[0]?.count ?? 0)
  databaseCounts.sheets_outbox = outboxCount
  if (outboxCount) {
    empty = false
    exact = false
    conflicts.push({ entity: 'sheets_outbox', id: '-', reason: 'target_has_outbox_history' })
  }

  return { empty, exact, conflicts, counts: databaseCounts }
}

async function ensureSchema(client) {
  const result = await client.query(`
    SELECT to_regclass('public.customers') AS customers,
           to_regclass('public.reservations') AS reservations,
           to_regclass('public.questionnaires') AS questionnaires,
           to_regclass('public.customer_reservation_counts') AS counts,
           to_regclass('public.sheets_outbox') AS outbox
  `)
  const schema = result.rows[0]
  if (!schema?.customers || !schema.reservations || !schema.questionnaires || !schema.counts || !schema.outbox) {
    throw new Error('Run npm run db:migrate before importing legacy data')
  }
  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN ('customers', 'reservations', 'questionnaires')
       AND column_name = 'raw_legacy'`,
  )
  if (columns.rowCount !== 3) throw new Error('The legacy JSON preservation migration is missing')
}

function insertBatchSql(table, columns, rows) {
  const values = []
  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      values.push(column === 'raw_legacy' ? JSON.stringify(JSON.parse(row[column])) : row[column])
      return `$${values.length}`
    })
    return `(${placeholders.join(', ')})`
  })
  return { sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values }
}

async function insertRows(client, table, columns, rows) {
  const batchSize = 200
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const statement = insertBatchSql(table, columns, batch)
    await client.query(statement.sql, statement.values)
  }
}

async function main() {
  const { source, apply } = parseArgs(process.argv.slice(2))
  loadEnvConfig(process.cwd())
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

  const sourceRows = source === 'json' ? await readJsonSource() : await readSheetsSource()
  const issues = []
  const warnings = []
  const rows = buildRows(sourceRows, source, issues)
  const inferredMarkerCount = validateRelations(rows, issues, warnings)
  reportIssues('Source validation issues', issues)
  reportIssues('Import warnings', warnings)
  console.log(
    `Source counts: customers=${rows.customers.length}, reservations=${rows.reservations.length}, questionnaires=${rows.questionnaires.length}, visitMarkers=${rows.customers.reduce((count, customer) => count + customer.count_markers.length, 0)}`,
  )
  console.log(`Inferred visit markers: ${inferredMarkerCount}`)

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  let transactionOpen = false
  try {
    await client.connect()
    if (apply) {
      await client.query('SELECT pg_advisory_lock($1, $2)', [1902592026, 2])
      await client.query('BEGIN')
      transactionOpen = true
      await client.query(
        'LOCK TABLE customer_reservation_counts, customers, questionnaires, reservations, sheets_outbox IN SHARE ROW EXCLUSIVE MODE',
      )
    } else {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      transactionOpen = true
    }
    await ensureSchema(client)
    const target = await inspectTargetDatabase(client, rows)
    reportIssues('Database target differences', target.conflicts)
    console.log(
      `Database counts: customers=${target.counts.customers}, reservations=${target.counts.reservations}, questionnaires=${target.counts.questionnaires}, visitMarkers=${target.counts.customer_reservation_counts}, outbox=${target.counts.sheets_outbox}`,
    )
    if (issues.length || (!target.empty && !target.exact)) {
      await client.query('ROLLBACK')
      transactionOpen = false
      console.log('Import not applied. Target data must be empty or an exact match for this source.')
      process.exitCode = 2
      return
    }

    if (!target.empty && target.exact) {
      await client.query('ROLLBACK')
      transactionOpen = false
      console.log('Target already contains the exact source IDs and data; no rows were changed.')
      return
    }

    if (!apply) {
      await client.query('ROLLBACK')
      transactionOpen = false
      console.log('Dry run complete; no database rows were changed. Use --apply to import this source.')
      return
    }

    await insertRows(client, 'customers', CUSTOMER_COLUMNS, rows.customers)
    await insertRows(client, 'reservations', RESERVATION_COLUMNS, rows.reservations)
    await insertRows(client, 'questionnaires', QUESTIONNAIRE_COLUMNS, rows.questionnaires)
    const markerRows = rows.customers.flatMap((customer) => customer.count_markers.map((reservationId) => ({
      customer_id: customer.id,
      reservation_id: reservationId,
    })))
    await insertRows(client, 'customer_reservation_counts', ['customer_id', 'reservation_id'], markerRows)
    await client.query('COMMIT')
    transactionOpen = false
    console.log('Legacy import committed.')
  } catch {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {})
    process.exitCode = 1
    console.error('Legacy import failed; no partial transaction was committed.')
  } finally {
    await client.end().catch(() => {})
  }
}

const invokedScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined
if (invokedScript === import.meta.url) {
  main().catch((error) => {
    process.exitCode = 1
    console.error(error instanceof Error ? error.message : 'Legacy import failed')
  })
}
