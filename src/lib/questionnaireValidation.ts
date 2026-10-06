import type { QuestionnaireFormData } from '@/types'

export const SLEEP_OPTIONS = ['6時間以上', '4時間以上6時間未満', '4時間未満'] as const
export const CARD_OPTIONS = ['未取得', 'OW', 'AOW', 'Rescue', 'DM', 'Inst'] as const
export const ORG_OPTIONS = ['PADI', 'NAUI', 'SSI', 'BSAC', 'その他'] as const
export const DIVE_OPTIONS = ['1ヶ月以内', '半年以内', '1年以内', '1年以上', '初めて'] as const
export const TODAY_FIELDS = ['sleepCategory','alcoholLastNight','alcoholToday','condition','conditionDetails','flightWithin48h'] as const
export const EXPERIENCE_FIELDS = ['cCardType','cCardOrg','lastDivePeriod','totalDives'] as const
export const HEALTH_FIELDS = [
  ['heartDisease', '心臓・循環器系疾患（心臓病・不整脈）'],
  ['highBloodPressure', '高血圧'],
  ['respiratoryDisease', '呼吸器系疾患（喘息・肺疾患）'],
  ['earDisease', '耳・副鼻腔の疾患'],
  ['epilepsy', 'てんかん・失神の既往'],
  ['diabetes', '糖尿病'],
  ['pregnant', '妊娠中'],
  ['panicDisorder', 'パニック障害・閉所恐怖症'],
  ['latexAllergy', 'ラテックスアレルギー'],
] as const

export type FieldErrors = Record<string, string>
export const BASIC_FIELDS = ['lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'birthDate', 'postalCode', 'address', 'phone', 'email', 'emergencyName', 'emergencyRelation', 'emergencyPhone', 'gender'] as const

export function todayInJapan(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function calculateAge(birthDate: string, referenceDate = todayInJapan()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || birthDate > referenceDate) return null
  const parsed = new Date(`${birthDate}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate || birthDate.startsWith('0000')) return null
  return Number(referenceDate.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (referenceDate.slice(5) < birthDate.slice(5) ? 1 : 0)
}

export function validateQuestionnaire(input: unknown, section: 'basic' | 'health' | 'today' | 'experience' | 'agree' | 'all' = 'all'): FieldErrors {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const errors: FieldErrors = {}
  const required = '必須項目が入力されていません。'
  const value = (key: string) => typeof data[key] === 'string' ? (data[key] as string).trim() : ''
  if (section === 'all' || section === 'basic') {
    for (const key of BASIC_FIELDS) {
      if (key !== 'gender' && !value(key)) errors[key] = required
    }
    for (const key of ['lastNameKana', 'firstNameKana']) {
      if (value(key) && !/^[ァ-ヺー　 ]+$/.test(value(key))) errors[key] = '全角カタカナで入力してください。'
    }
    if (value('birthDate') && calculateAge(value('birthDate')) === null) errors.birthDate = '生年月日を正しく入力してください。'
    if (!['male', 'female', 'other', 'unanswered'].includes(value('gender'))) errors.gender = '性別を正しく選択してください。'
    if (value('postalCode') && !/^\d{3}-?\d{4}$/.test(value('postalCode'))) errors.postalCode = '郵便番号は半角数字7桁で入力してください。'
    for (const key of ['phone', 'emergencyPhone']) {
      if (value(key) && !/^\d+(?:-\d+)*$/.test(value(key))) errors[key] = '電話番号は半角数字とハイフンで入力してください。'
    }
    if (value('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) errors.email = 'メールアドレスの形式が正しくありません。'
  }
  if (section === 'all' || section === 'health') {
    for (const key of [...HEALTH_FIELDS.map(([key]) => key), 'medication', 'medicalCertificate']) {
      if (typeof data[key] !== 'boolean') errors[key] = required
    }
    if (data.medication === true && !value('medicationName')) errors.medicationName = required
  }
  const choice = (key: string, options: readonly string[]) => {
    if (!options.includes(value(key))) errors[key] = '選択肢から回答してください。'
  }
  if (section === 'all' || section === 'today') {
    choice('sleepCategory', SLEEP_OPTIONS)
    for (const key of ['alcoholLastNight','alcoholToday','flightWithin48h']) {
      if (typeof data[key] !== 'boolean') errors[key] = required
    }
    choice('condition', ['good','normal','bad'])
    if (data.condition === 'bad' && !value('conditionDetails')) errors.conditionDetails = required
    if (data.conditionDetails != null && (typeof data.conditionDetails !== 'string' || data.conditionDetails.length > 500)) errors.conditionDetails = '体調詳細は500文字以内で入力してください。'
  }
  if (section === 'all' || section === 'experience') {
    choice('cCardType', CARD_OPTIONS)
    if (typeof data.hasCCard !== 'boolean' || data.hasCCard !== (data.cCardType !== '未取得')) errors.cCardType = 'Cカードの有無・種別を確認してください。'
    if (value('cCardOrg')) choice('cCardOrg', ORG_OPTIONS)
    if (data.hasCCard === false && value('cCardOrg')) errors.cCardOrg = '未取得の場合は認定団体を空欄にしてください。'
    choice('lastDivePeriod', DIVE_OPTIONS)
    if (data.totalDives !== null && (typeof data.totalDives !== 'number' || !Number.isSafeInteger(data.totalDives) || data.totalDives < 0)) errors.totalDives = '半角数値で0以上の整数を入力してください。'
    if (data.lastDivePeriod === '初めて' && data.totalDives !== null && data.totalDives !== 0) errors.totalDives = '初めての場合は0本または未入力にしてください。'
  }
  if (section === 'all' || section === 'agree') {
    for (const key of ['agreeRisk','agreeMedical']) if (data[key] !== true) errors[key] = '同意事項に同意してください。'
    if (typeof data.agreePhoto !== 'boolean') errors.agreePhoto = '写真・動画の使用可否を選択してください。'
  }
  const order = [...BASIC_FIELDS, ...HEALTH_FIELDS.map(([key]) => key), 'medication', 'medicationName', 'medicalCertificate', ...TODAY_FIELDS, ...EXPERIENCE_FIELDS, 'agreeRisk','agreeMedical','agreePhoto']
  return Object.fromEntries(order.filter((key) => errors[key]).map((key) => [key, errors[key]]))
}

/** Validates and projects only guest-owned fields; never copy server metadata from the body. */
export function validateQuestionnaireInput(input: unknown): { ok: true; data: QuestionnaireFormData } | { ok: false; errors: FieldErrors } {
  const errors = validateQuestionnaire(input)
  if (Object.keys(errors).length) return { ok: false, errors }
  const source = input as Record<string, unknown>
  const keys = [...BASIC_FIELDS, ...HEALTH_FIELDS.map(([key]) => key), 'medication','medicationName','medicalCertificate', ...TODAY_FIELDS, ...EXPERIENCE_FIELDS, 'hasCCard','agreeRisk','agreeMedical','agreePhoto']
  const data = Object.fromEntries(keys.map((key) => [key, typeof source[key] === 'string' ? source[key].trim() : source[key]]))
  return { ok: true, data: { ...data, sleepHours: null, lastDiveDate: '',
    medicationName: source.medication ? data.medicationName : '',
    conditionDetails: source.condition === 'bad' ? data.conditionDetails : '',
    cCardOrg: source.hasCCard ? (data.cCardOrg ?? '') : '',
  } as QuestionnaireFormData }
}
