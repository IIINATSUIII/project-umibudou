/** Canonical columns. Never infer a column's meaning from its position. */
export const QUESTIONNAIRE_COLUMNS = [
  'id','reservationId','submittedAt','lastName','firstName','lastNameKana','firstNameKana',
  'birthDate','gender','address','phone','emergencyName','emergencyRelation','emergencyPhone',
  'heartDisease','respiratoryDisease','earDisease','epilepsy','diabetes','pregnant',
  'panicDisorder','medication','medicationName','latexAllergy','sleepHours','alcoholLastNight',
  'alcoholToday','condition','flightWithin48h','hasCCard','cCardType','cCardOrg','lastDiveDate',
  'totalDives','agreeRisk','agreeMedical','agreePhoto',
  'customerId','postalCode','email','highBloodPressure','conditionDetails','consentAt',
  'qrToken','qrExpiresAt','qrUsed','doctorClearance','staffReviewStatus','staffReviewNotes',
  'medicalCertificate','sleepCategory','lastDivePeriod','qrIssuedAt',
] as const

const aliases: Record<string, string> = {
  hypertension: 'highBloodPressure', conditionDetail: 'conditionDetails',
  doctorDivingPermit: 'doctorClearance', staffCheckStatus: 'staffReviewStatus', staffCheckNote: 'staffReviewNotes',
}
const booleans = new Set(['heartDisease','respiratoryDisease','earDisease','epilepsy','diabetes',
  'pregnant','panicDisorder','medication','latexAllergy','alcoholLastNight','alcoholToday',
  'flightWithin48h','hasCCard','agreeRisk','agreeMedical','agreePhoto','highBloodPressure','medicalCertificate','qrUsed'])
function decode(key: string, value: unknown): unknown {
  if (booleans.has(key)) {
    if (value === '' || value == null) return undefined
    if (value === true || value === 'TRUE' || value === 'true') return true
    if (value === false || value === 'FALSE' || value === 'false') return false
    throw new Error(`Invalid boolean column: ${key}`)
  }
  if (key === 'sleepHours' || key === 'totalDives') {
    if (value === '' || value == null) return null
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error(`Invalid number column: ${key}`)
    return number
  }
  return value ?? ''
}

/** Normalize legacy JSON / headers. Conflicting aliases require manual resolution. */
export function normalizeQuestionnaireRecord(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(input)) {
    const key = aliases[name] ?? name
    const value = decode(key, raw)
    if (result[key] !== undefined && result[key] !== '' && value !== undefined && value !== '' && result[key] !== value) {
      throw new Error(`Conflicting questionnaire fields: ${key}`)
    }
    if (!(key in result) || (value !== undefined && value !== '')) result[key] = value
  }
  return result
}

export function readQuestionnaireTable(table: unknown[][]): Record<string, unknown>[] {
  if (!table.length) return []
  const headers = table[0].map(String)
  if (headers[0] !== 'id' || new Set(headers).size !== headers.length || headers.some((h) => !h.trim())) {
    throw new Error('Missing or duplicate questionnaire headers; restore the original header before migration')
  }
  return table.slice(1).filter((row) => row.some((v) => v !== '' && v != null)).map((row) => {
    if (row.slice(headers.length).some((v) => v !== '' && v != null)) throw new Error('Unlabelled questionnaire columns; migration stopped')
    return normalizeQuestionnaireRecord(Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])))
  })
}

export function questionnaireRow(headers: readonly string[], data: Record<string, unknown>): string[] {
  return headers.map((key) => data[key] == null ? '' : String(data[key]))
}

/** Pure, repeatable migration. Retain unknown columns; caller writes to a NEW sheet/file. */
export function migrateQuestionnaireTable(table: unknown[][]): string[][] {
  const records = readQuestionnaireTable(table)
  const extra = (table[0] ?? []).map(String).map((key) => aliases[key] ?? key)
    .filter((key) => !QUESTIONNAIRE_COLUMNS.includes(key as typeof QUESTIONNAIRE_COLUMNS[number]))
  const headers = [...QUESTIONNAIRE_COLUMNS, ...Array.from(new Set(extra))]
  return [headers, ...records.map((record) => questionnaireRow(headers, record))]
}

export function requireCanonicalHeaders(headers: unknown[]): string[] {
  const names = headers.map(String)
  if (QUESTIONNAIRE_COLUMNS.some((key, i) => names[i] !== key) || new Set(names).size !== names.length || names.some((key) => !key)) {
    throw new Error('Questionnaire schema migration required; do not replace only the header row')
  }
  return names
}
