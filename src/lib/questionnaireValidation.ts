export const HEALTH_FIELDS = [
  ['heartDisease', '心臓・循環器系疾患（心臓病・不整脈）'],
  ['hypertension', '高血圧'],
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

export function validateQuestionnaire(input: unknown, section: 'basic' | 'health' | 'all' = 'all'): FieldErrors {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const errors: FieldErrors = {}
  const required = '必須項目が入力されていません。'
  const value = (key: string) => typeof data[key] === 'string' ? (data[key] as string).trim() : ''
  if (section !== 'health') {
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
  if (section !== 'basic') {
    for (const key of [...HEALTH_FIELDS.map(([key]) => key), 'medication', 'medicalCertificate']) {
      if (typeof data[key] !== 'boolean') errors[key] = required
    }
    if (data.medication === true && !value('medicationName')) errors.medicationName = required
  }
  const order = [...BASIC_FIELDS, ...HEALTH_FIELDS.map(([key]) => key), 'medication', 'medicationName', 'medicalCertificate']
  return Object.fromEntries(order.filter((key) => errors[key]).map((key) => [key, errors[key]]))
}
