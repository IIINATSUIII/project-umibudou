import { COURSES, STAFF, STATUSES } from './masters'
import type { Reservation } from '@/types'

export type NewReservationInput = {
  guestName: string
  guestPhone: string
  guestEmail: string
  diveDate: string
  timeSlot: Reservation['timeSlot']
  courseId: string
  guestCount: number
  channel: Reservation['channel']
  status?: string
  staffId?: string
  divePoint?: string
  staffNote?: string
  customerId?: string
}

export type ReservationFieldErrors = Partial<Record<keyof NewReservationInput | 'form', string>>

export type ReservationValidationResult =
  | { ok: true; data: NewReservationInput }
  | { ok: false; message: string; fields: ReservationFieldErrors }

export class ReservationValidationError extends Error {
  readonly fields: ReservationFieldErrors

  constructor(fields: ReservationFieldErrors, message = '入力内容を確認してください') {
    super(message)
    this.name = 'ReservationValidationError'
    this.fields = fields
  }
}

const TIME_SLOT_VALUES: readonly Reservation['timeSlot'][] = [
  'morning',
  'afternoon',
  'full',
  'unspecified',
]

const MANUAL_CHANNEL_VALUES: readonly Reservation['channel'][] = ['hp', 'email', 'phone']
const ALL_CHANNEL_VALUES: readonly Reservation['channel'][] = [...MANUAL_CHANNEL_VALUES, 'ota']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(
  input: Record<string, unknown>,
  field: keyof NewReservationInput,
  label: string,
  maxLength: number,
  fields: ReservationFieldErrors
): string {
  const value = input[field]
  if (typeof value !== 'string' || value.trim() === '') {
    fields[field] = `${label}を入力してください`
    return ''
  }

  const normalized = value.trim()
  if (normalized.length > maxLength) {
    fields[field] = `${label}は${maxLength}文字以内で入力してください`
  }
  return normalized
}

function optionalText(
  input: Record<string, unknown>,
  field: keyof NewReservationInput,
  label: string,
  maxLength: number,
  fields: ReservationFieldErrors
): string | undefined {
  const value = input[field]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    fields[field] = `${label}の形式が正しくありません`
    return undefined
  }

  const normalized = value.trim()
  if (normalized.length > maxLength) {
    fields[field] = `${label}は${maxLength}文字以内で入力してください`
  }
  return normalized || undefined
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * 予約登録入力を検証し、保存可能な形へ正規化する。
 * allowOta=false はスタッフの手動登録用で、OTA-CSVを手動フォームから登録させない。
 */
export function validateNewReservationInput(
  input: unknown,
  options: { allowOta?: boolean } = {}
): ReservationValidationResult {
  const fields: ReservationFieldErrors = {}
  if (!isRecord(input)) {
    return { ok: false, message: '入力内容を確認してください', fields: { form: '入力内容が不正です' } }
  }

  const guestName = requiredText(input, 'guestName', '代表者氏名', 50, fields)
  const guestPhone = requiredText(input, 'guestPhone', '電話番号', 20, fields)
  const guestEmail = requiredText(input, 'guestEmail', 'メールアドレス', 100, fields)
  const divePoint = optionalText(input, 'divePoint', 'ダイブポイント', 100, fields)
  const staffNote = optionalText(input, 'staffNote', 'スタッフメモ', 500, fields)
  const customerId = optionalText(input, 'customerId', '顧客ID', 50, fields)

  if (guestPhone && !/^(?=.*\d)[0-9-]+$/.test(guestPhone)) {
    fields.guestPhone = '電話番号は数字とハイフンのみで入力してください'
  }
  if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
    fields.guestEmail = 'メールアドレスの形式が正しくありません'
  }

  const diveDate = input.diveDate
  if (typeof diveDate !== 'string' || !isValidDateOnly(diveDate)) {
    fields.diveDate = 'ダイブ日を正しく入力してください'
  }

  const timeSlot = input.timeSlot
  if (!TIME_SLOT_VALUES.includes(timeSlot as Reservation['timeSlot'])) {
    fields.timeSlot = '時間帯を選択してください'
  }

  const courseId = input.courseId
  if (typeof courseId !== 'string' || !COURSES.some((course) => course.id === courseId)) {
    fields.courseId = 'コースを選択してください'
  }

  const guestCount = input.guestCount
  if (typeof guestCount !== 'number' || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) {
    fields.guestCount = '人数は1〜20名の整数で入力してください'
  }

  const channel = input.channel
  const allowedChannels = options.allowOta ? ALL_CHANNEL_VALUES : MANUAL_CHANNEL_VALUES
  if (!allowedChannels.includes(channel as Reservation['channel'])) {
    fields.channel = options.allowOta
      ? '予約取込元を選択してください'
      : '手動登録の取込元はHP・メール・電話から選択してください'
  }

  const status = input.status
  if (status !== undefined && (typeof status !== 'string' || !STATUSES.some((item) => item.id === status))) {
    fields.status = '予約ステータスが不正です'
  }

  const staffId = optionalText(input, 'staffId', '担当スタッフID', 50, fields)
  if (staffId && !STAFF.some((staff) => staff.id === staffId)) {
    fields.staffId = '担当スタッフが不正です'
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, message: '入力内容を確認してください', fields }
  }

  return {
    ok: true,
    data: {
      guestName,
      guestPhone,
      guestEmail,
      diveDate: diveDate as string,
      timeSlot: timeSlot as Reservation['timeSlot'],
      courseId: courseId as string,
      guestCount: guestCount as number,
      channel: channel as Reservation['channel'],
      ...(status !== undefined ? { status: status as string } : {}),
      ...(staffId ? { staffId } : {}),
      ...(divePoint ? { divePoint } : {}),
      ...(staffNote ? { staffNote } : {}),
      ...(customerId ? { customerId } : {}),
    },
  }
}

export function assertValidNewReservationInput(input: NewReservationInput): NewReservationInput {
  const result = validateNewReservationInput(input, { allowOta: true })
  if (!result.ok) throw new ReservationValidationError(result.fields, result.message)
  return result.data
}
