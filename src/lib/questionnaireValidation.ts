import type { QuestionnaireData } from '@/types'

export type QuestionnaireInput = Omit<QuestionnaireData, 'id' | 'reservationId' | 'submittedAt'>
export type QuestionnaireValidationResult =
  | { ok: true; data: QuestionnaireInput }
  | { ok: false; errors: Record<string, string> }

const GENDERS = new Set(['male', 'female', 'other'])
const CONDITIONS = new Set(['good', 'normal', 'bad'])

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function bool(value: unknown): boolean | undefined { return typeof value === 'boolean' ? value : undefined }
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00+09:00`)
  return !Number.isNaN(date.getTime()) && date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) === value
}
function isPhone(value: string): boolean { return /^[0-9０-９+()\-\s]{7,20}$/.test(value) }
function isKana(value: string): boolean { return /^[ァ-ヶー\s]+$/.test(value) }
function isEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }

function requiredString(errors: Record<string, string>, source: Record<string, unknown>, key: string, label: string, max = 200): string {
  const value = text(source[key])
  if (!value) errors[key] = `${label}を入力してください`
  else if (value.length > max) errors[key] = `${label}は${max}文字以内で入力してください`
  return value
}

function optionalString(errors: Record<string, string>, source: Record<string, unknown>, key: string, label: string, max: number): string {
  const value = text(source[key])
  if (value.length > max) errors[key] = `${label}は${max}文字以内で入力してください`
  return value
}

/** クライアント入力を検証し、サーバー管理項目を含まない保存用データを返す。 */
export function validateQuestionnaireInput(input: unknown): QuestionnaireValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { form: '入力データが不正です' } }
  const source = input as Record<string, unknown>
  const errors: Record<string, string> = {}
  const lastName = requiredString(errors, source, 'lastName', '姓')
  const firstName = requiredString(errors, source, 'firstName', '名')
  const lastNameKana = requiredString(errors, source, 'lastNameKana', '姓（カナ）', 100)
  const firstNameKana = requiredString(errors, source, 'firstNameKana', '名（カナ）', 100)
  const birthDate = requiredString(errors, source, 'birthDate', '生年月日', 10)
  const postalCode = optionalString(errors, source, 'postalCode', '郵便番号', 10)
  const address = requiredString(errors, source, 'address', '住所')
  const phone = requiredString(errors, source, 'phone', '電話番号', 20)
  const email = requiredString(errors, source, 'email', 'メールアドレス', 254)
  const emergencyName = requiredString(errors, source, 'emergencyName', '緊急連絡先氏名')
  const emergencyRelation = requiredString(errors, source, 'emergencyRelation', '緊急連絡先続柄', 50)
  const emergencyPhone = requiredString(errors, source, 'emergencyPhone', '緊急連絡先電話番号', 20)
  const medicationName = optionalString(errors, source, 'medicationName', '薬剤名', 200)
  const cCardType = optionalString(errors, source, 'cCardType', 'Cカード種別', 50)
  const cCardOrg = optionalString(errors, source, 'cCardOrg', '認定団体', 50)
  const lastDiveDate = optionalString(errors, source, 'lastDiveDate', '最終ダイビング時期', 7)
  const conditionDetail = optionalString(errors, source, 'conditionDetail', '体調詳細', 500)

  if (lastNameKana && !isKana(lastNameKana)) errors.lastNameKana = '姓（カナ）は全角カタカナで入力してください'
  if (firstNameKana && !isKana(firstNameKana)) errors.firstNameKana = '名（カナ）は全角カタカナで入力してください'
  if (birthDate && (!isDate(birthDate) || birthDate > new Date().toISOString().slice(0, 10))) errors.birthDate = '生年月日を正しく入力してください'
  if (phone && !isPhone(phone)) errors.phone = '電話番号の形式が正しくありません'
  if (email && !isEmail(email)) errors.email = 'メールアドレスの形式が正しくありません'
  if (emergencyPhone && !isPhone(emergencyPhone)) errors.emergencyPhone = '緊急連絡先電話番号の形式が正しくありません'
  if (!GENDERS.has(String(source.gender))) errors.gender = '性別の値が不正です'
  if (!CONDITIONS.has(String(source.condition))) errors.condition = '体調の値が不正です'
  if (!lastDiveDate) errors.lastDiveDate = '最終ダイビング時期を入力してください'
  else if (!/^\d{4}-\d{2}$/.test(lastDiveDate)) errors.lastDiveDate = '最終ダイビング時期の形式が不正です'

  const booleanKeys = ['heartDisease','hypertension','respiratoryDisease','earDisease','epilepsy','diabetes','pregnant','panicDisorder','medication','latexAllergy','alcoholLastNight','alcoholToday','flightWithin48h','hasCCard','agreeRisk','agreeMedical','agreePhoto'] as const
  const values = {} as Record<typeof booleanKeys[number], boolean>
  for (const key of booleanKeys) {
    const value = bool(source[key])
    if (value === undefined) errors[key] = '値が不正です'
    else values[key] = value
  }

  const sleepHours = source.sleepHours
  const totalDives = source.totalDives
  if (typeof sleepHours !== 'number' || !Number.isInteger(sleepHours) || sleepHours < 1 || sleepHours > 12) errors.sleepHours = '睡眠時間は1〜12の整数で入力してください'
  if (typeof totalDives !== 'number' || !Number.isInteger(totalDives) || totalDives < 0) errors.totalDives = '総ダイビング本数は0以上の整数で入力してください'
  if (source.condition === 'bad' && !conditionDetail) errors.conditionDetail = '体調が悪い場合は詳細を入力してください'
  if (values.medication && !medicationName) errors.medicationName = '服薬中の場合は薬剤名を入力してください'
  if (values.hasCCard && (!cCardType || !cCardOrg)) errors.cCard = 'Cカード保有時は種別と認定団体を入力してください'
  if (!values.agreeRisk || !values.agreeMedical || !values.agreePhoto) errors.agree = '同意事項をすべて確認してください'
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return { ok: true, data: {
    lastName, firstName, lastNameKana, firstNameKana, birthDate,
    gender: source.gender as QuestionnaireData['gender'], postalCode, address, phone, email,
    emergencyName, emergencyRelation, emergencyPhone,
    heartDisease: values.heartDisease, hypertension: values.hypertension, respiratoryDisease: values.respiratoryDisease, earDisease: values.earDisease,
    epilepsy: values.epilepsy, diabetes: values.diabetes, pregnant: values.pregnant, panicDisorder: values.panicDisorder,
    medication: values.medication, medicationName, latexAllergy: values.latexAllergy,
    sleepHours: sleepHours as number, alcoholLastNight: values.alcoholLastNight, alcoholToday: values.alcoholToday,
    condition: source.condition as QuestionnaireData['condition'], conditionDetail, flightWithin48h: values.flightWithin48h,
    hasCCard: values.hasCCard, cCardType: values.hasCCard ? cCardType : '', cCardOrg: values.hasCCard ? cCardOrg : '',
    lastDiveDate, totalDives: totalDives as number, agreeRisk: values.agreeRisk, agreeMedical: values.agreeMedical, agreePhoto: values.agreePhoto,
  } }
}
