import type {
  Reservation,
  QuestionnaireData,
  Customer,
  RosterEntry,
} from '@/types'
import { COURSES, getCourseName, getStaffName, STATUSES } from './masters'

export const LEGACY_RESERVATION_HEADERS = [
  'id',
  'date',
  'time',
  'course',
  'guestName',
  'guestCount',
  'phone',
  'channel',
  'status',
  'questionnaireId',
  'notes',
]
export const LEGACY_QUESTIONNAIRE_HEADERS = [
  'id',
  'reservationId',
  'submittedAt',
  'lastName',
  'firstName',
  'lastNameKana',
  'firstNameKana',
  'birthDate',
  'gender',
  'address',
  'phone',
  'emergencyName',
  'emergencyRelation',
  'emergencyPhone',
  'heartDisease',
  'respiratoryDisease',
  'earDisease',
  'epilepsy',
  'diabetes',
  'pregnant',
  'panicDisorder',
  'medication',
  'medicationName',
  'latexAllergy',
  'sleepHours',
  'alcoholLastNight',
  'alcoholToday',
  'condition',
  'flightWithin48h',
  'hasCCard',
  'cCardType',
  'cCardOrg',
  'lastDiveDate',
  'totalDives',
  'agreeRisk',
  'agreeMedical',
  'agreePhoto',
]
export const HEADERS = {
  RESERVATIONS: [
    'id',
    'createdAt',
    'updatedAt',
    'customerId',
    'guestName',
    'guestPhone',
    'guestEmail',
    'diveDate',
    'timeSlot',
    'courseId',
    'courseName',
    'guestCount',
    'status',
    'staffId',
    'staffName',
    'channel',
    'questionnaireToken',
    'questionnaireTokenExpiresAt',
    'questionnaireCompleted',
    'divePoint',
    'staffNote',
    'questionnaireId',
    'legacyTime',
    'legacyChannel',
  ],
  QUESTIONNAIRES: [
    ...LEGACY_QUESTIONNAIRE_HEADERS,
    'customerId',
    'postalCode',
    'email',
    'hypertension',
    'medicalCertificate',
    'sleepCategory',
    'conditionDetails',
    'lastDivePeriod',
    'consentAt',
    'qrToken',
    'qrIssuedAt',
    'qrExpiresAt',
    'qrUsed',
    'doctorClearance',
    'staffCheckStatus',
    'staffCheckNote',
    'submissionState',
  ],
  CUSTOMERS: [
    'id',
    'lastName',
    'firstName',
    'lastNameKana',
    'firstNameKana',
    'phone',
    'email',
    'lastVisit',
    'visitCount',
    'hasCCard',
    'cCardType',
    'totalDives',
    'healthNotes',
    'guideNotes',
    'createdAt',
    'updatedAt',
    'birthDate',
    'gender',
    'address',
    'emergencyName',
    'emergencyRelation',
    'emergencyPhone',
    'cCardOrg',
    'lastDiveDate',
    'postalCode',
    'dmConsent',
    'countedQuestionnaireIds',
    'lastDivePeriod',
  ],
  ROSTER: [
    'id',
    'diveDate',
    'reservationId',
    'questionnaireId',
    'customerId',
    'name',
    'nameKana',
    'birthDate',
    'age',
    'gender',
    'address',
    'phone',
    'emergencyContact',
    'emergencyPhone',
    'course',
    'staffName',
    'checkedInAt',
    'checkInMethod',
  ],
}
export type StoreKind = keyof typeof HEADERS
export type RecordValue = Record<string, unknown>
const text = (v: unknown) =>
  typeof v === 'string' ? v : v == null ? '' : String(v)
const optional = (v: unknown) => text(v) || undefined
const bool = (v: unknown) => v === true || v === 'TRUE' || v === 'true'
const nullableBool = (v: unknown) =>
  v === undefined || v === null || v === '' ? undefined : bool(v)
const number = (v: unknown) =>
  v === null || v === undefined || v === '' ? null : Number(v)

const QUESTIONNAIRE_ALIAS_GROUPS = [
  ['hypertension', 'highBloodPressure'],
  ['conditionDetails', 'conditionDetail', 'conditionNote'],
  ['sleepCategory', 'sleepDuration'],
  ['lastDivePeriod', 'lastDiveExperience'],
  ['consentAt', 'consentedAt'],
  ['doctorClearance', 'doctorDivingPermit'],
  ['staffCheckStatus', 'staffReviewStatus'],
  ['staffCheckNote', 'staffReviewNotes'],
  ['cCardType', 'cCardStatus'],
]

const populatedValue = (value: unknown) =>
  value !== undefined && value !== null && text(value).trim() !== ''
const migrationBoolean = (value: unknown): boolean => {
  const normalized = text(value).trim()
  if (normalized === 'TRUE' || normalized === 'true') return true
  if (normalized === 'FALSE' || normalized === 'false') return false
  throw new Error('問診の高血圧・Cカード有無のboolean形式が不正です')
}

/** 移行前だけに使用する。通常の読取・更新契約は変更しない。 */
export function assertQuestionnaireAliases(v: RecordValue): void {
  if (populatedValue(v.hasCCard)) migrationBoolean(v.hasCCard)
  for (const fields of QUESTIONNAIRE_ALIAS_GROUPS) {
    const values = fields
      .filter((field) => populatedValue(v[field]))
      .map((field) => {
        if (fields[0] === 'hypertension') return migrationBoolean(v[field])
        const value = text(v[field]).trim()
        return fields[0] === 'sleepCategory' && value === '4〜6時間'
          ? '4時間以上6時間未満'
          : value
      })
    if (new Set(values).size > 1) {
      // 健康情報・個人情報の値をエラーやログに含めない。
      throw new Error(`問診の別名項目が矛盾しています: ${fields.join(' / ')}`)
    }
  }
  if (populatedValue(v.cCardStatus) && populatedValue(v.hasCCard) &&
    migrationBoolean(v.hasCCard) !== (text(v.cCardStatus).trim() !== '未取得')) {
    throw new Error('問診の別名項目が矛盾しています: hasCCard / cCardStatus')
  }
}

export function normalizeReservation(v: RecordValue): Reservation {
  if (!text(v.id)) throw new Error('予約IDのない既存行は自動変換できません')
  const courseId =
    text(v.courseId) || COURSES.find((c) => c.name === text(v.course))?.id || ''
  const status = text(v.status)
  const legacyTime = text(v.legacyTime ?? v.time)
  const hour = Number(legacyTime.slice(0, 2))
  return {
    ...v,
    id: text(v.id),
    createdAt: text(v.createdAt),
    updatedAt: text(v.updatedAt ?? v.createdAt),
    customerId: optional(v.customerId),
    guestName: text(v.guestName),
    guestPhone: text(v.guestPhone ?? v.phone),
    guestEmail: text(v.guestEmail ?? v.email),
    diveDate: text(v.diveDate ?? v.date),
    timeSlot: ['morning', 'afternoon', 'full', 'unspecified'].includes(
      text(v.timeSlot)
    )
      ? (v.timeSlot as Reservation['timeSlot'])
      : /^\d{2}:\d{2}$/.test(legacyTime)
        ? hour < 12
          ? 'morning'
          : 'afternoon'
        : 'unspecified',
    courseId,
    courseName: text(v.courseName ?? v.course) || getCourseName(courseId),
    guestCount: Number(v.guestCount),
    status: STATUSES.some((s) => s.id === status)
      ? status
      : (
          {
            confirmed: 'STS-03',
            pending: 'STS-01',
            cancelled: 'STS-04',
          } as Record<string, string>
        )[status] || status,
    staffId: optional(v.staffId),
    staffName: text(v.staffName) || getStaffName(optional(v.staffId)),
    channel: text(v.channel) as Reservation['channel'],
    questionnaireToken: optional(v.questionnaireToken),
    questionnaireTokenExpiresAt: optional(
      v.questionnaireTokenExpiresAt || v.questionnaireExpiresAt
    ),
    questionnaireCompleted:
      bool(v.questionnaireCompleted) || !!text(v.questionnaireId),
    questionnaireId: optional(v.questionnaireId),
    staffNote: optional(v.staffNote ?? v.notes),
    divePoint: optional(v.divePoint),
    legacyTime: optional(legacyTime),
    legacyChannel: optional(v.legacyChannel ?? v.channel),
  }
}
const Q_BOOLEAN_FIELDS = [
  'heartDisease',
  'respiratoryDisease',
  'earDisease',
  'epilepsy',
  'diabetes',
  'pregnant',
  'panicDisorder',
  'medication',
  'latexAllergy',
  'alcoholLastNight',
  'alcoholToday',
  'flightWithin48h',
  'hasCCard',
  'agreeRisk',
  'agreeMedical',
  'agreePhoto',
  'qrUsed',
]
export function normalizeQuestionnaire(v: RecordValue): QuestionnaireData {
  if (!text(v.id) || !text(v.reservationId))
    throw new Error('問診ID・予約IDのない既存行は自動変換できません')
  const q = Object.fromEntries(
    HEADERS.QUESTIONNAIRES.map((h) => [h, v[h] ?? ''])
  ) as RecordValue
  for (const h of Q_BOOLEAN_FIELDS) q[h] = nullableBool(v[h])
  q.hypertension = nullableBool(v.hypertension ?? v.highBloodPressure)
  q.medicalCertificate = nullableBool(v.medicalCertificate)
  q.sleepHours = number(v.sleepHours)
  q.totalDives = number(v.totalDives)
  q.gender = ['male', 'female', 'other', 'unanswered'].includes(text(v.gender))
    ? v.gender
    : 'unanswered'
  q.conditionDetails = text(
    v.conditionDetails || v.conditionDetail || v.conditionNote
  )
  q.sleepCategory = text(v.sleepCategory || v.sleepDuration)
  if (q.sleepCategory === '4〜6時間') q.sleepCategory = '4時間以上6時間未満'
  q.lastDivePeriod = text(v.lastDivePeriod || v.lastDiveExperience)
  q.consentAt = text(v.consentAt || v.consentedAt) || text(v.submittedAt)
  q.doctorClearance = text(v.doctorClearance || v.doctorDivingPermit)
  q.staffCheckStatus =
    text(v.staffCheckStatus || v.staffReviewStatus) || '未確認'
  q.staffCheckNote = text(v.staffCheckNote || v.staffReviewNotes)
  if (v.cCardStatus !== undefined) {
    q.hasCCard = v.cCardStatus !== '未取得'
    q.cCardType = text(v.cCardStatus)
  }
  return { ...v, ...q } as unknown as QuestionnaireData
}

/** 空の追加列より、値が残っている旧名列を優先して移行する。 */
export function normalizeQuestionnaireForMigration(
  v: RecordValue,
): QuestionnaireData {
  assertQuestionnaireAliases(v)
  const resolved = { ...v }
  for (const fields of QUESTIONNAIRE_ALIAS_GROUPS) {
    const populated = fields.find((field) => populatedValue(v[field]))
    if (populated) {
      resolved[fields[0]] = fields[0] === 'hypertension'
        ? migrationBoolean(v[populated])
        : v[populated]
    }
  }
  // normalizeQuestionnaireの旧cCardStatus変換で空列が既存資格を上書きしない。
  // 矛盾検査後は既に解決したcCardTypeを使用する。
  delete resolved.cCardStatus
  if (populatedValue(v.hasCCard))
    resolved.hasCCard = migrationBoolean(v.hasCCard)
  else if (populatedValue(v.cCardStatus))
    resolved.hasCCard = text(v.cCardStatus).trim() !== '未取得'
  return normalizeQuestionnaire(resolved)
}
export function normalizeCustomer(v: RecordValue): Customer {
  return {
    ...v,
    createdAt: text(v.createdAt ?? v.registeredAt),
    updatedAt: text(v.updatedAt),
    visitCount: Number(v.visitCount || 0),
    totalDives: number(v.totalDives),
    hasCCard: bool(v.hasCCard),
    countedQuestionnaireIds: text(v.countedQuestionnaireIds) || '[]',
  } as unknown as Customer
}
export function normalizeRecord(
  kind: StoreKind,
  v: RecordValue
): Reservation | QuestionnaireData | Customer | RosterEntry {
  if (kind === 'RESERVATIONS') return normalizeReservation(v)
  if (kind === 'QUESTIONNAIRES') return normalizeQuestionnaire(v)
  if (kind === 'CUSTOMERS') return normalizeCustomer(v)
  return { ...v, age: Number(v.age) } as unknown as RosterEntry
}
export function assertKnownHeaders(kind: StoreKind, headers: string[]): void {
  if (new Set(headers).size !== headers.length || headers.some((h) => !h))
    throw new Error('重複・空のヘッダーがあります')
  const required =
    kind === 'RESERVATIONS'
      ? ['id', 'guestName', 'guestCount', 'status']
      : kind === 'QUESTIONNAIRES'
        ? [
            'id',
            'reservationId',
            'lastName',
            'firstName',
            'agreeRisk',
            'agreeMedical',
            'agreePhoto',
          ]
        : kind === 'CUSTOMERS'
          ? ['id', 'lastName', 'firstName', 'phone', 'email']
          : HEADERS.ROSTER
  if (!required.every((h) => headers.includes(h)))
    throw new Error(
      `${kind}のスキーマを認識できません。データを変更せず中止しました`
    )
  if (
    kind === 'RESERVATIONS' &&
    !headers.includes('date') &&
    !headers.includes('diveDate')
  )
    throw new Error('予約日列がありません')
}
