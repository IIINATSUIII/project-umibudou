/** Shared validation for SC-05 sections 3–5. Legacy records remain readable. */
export const SLEEP_OPTIONS = ['6時間以上', '4時間以上6時間未満', '4時間未満'] as const
export const CARD_OPTIONS = ['未取得', 'OW', 'AOW', 'Rescue', 'DM', 'Inst'] as const
export const ORG_OPTIONS = ['PADI', 'NAUI', 'SSI', 'BSAC', 'その他'] as const
export const DIVE_OPTIONS = ['1ヶ月以内', '半年以内', '1年以内', '1年以上', '初めて'] as const
export const TODAY_FIELDS = ['sleepCategory', 'alcoholLastNight', 'alcoholToday', 'condition', 'conditionDetails', 'flightWithin48h'] as const
export type FieldErrors = Record<string, string>

export function validateQuestionnaireExperience(value: unknown): FieldErrors {
  const b: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const errors: FieldErrors = {}
  const choice = (key: string, options: readonly string[], optional = false) => {
    if (optional && (b[key] === '' || b[key] === undefined)) return
    if (typeof b[key] !== 'string' || !options.includes(b[key] as string)) errors[key] = '選択肢から回答してください。'
  }
  choice('sleepCategory', SLEEP_OPTIONS)
  for (const key of ['alcoholLastNight', 'alcoholToday', 'flightWithin48h']) {
    if (typeof b[key] !== 'boolean') errors[key] = 'あり・なしを選択してください。'
  }
  choice('condition', ['good', 'normal', 'bad'])
  if (b.condition === 'bad' && (typeof b.conditionDetails !== 'string' || !b.conditionDetails.trim())) {
    errors.conditionDetails = '体調の詳細を入力してください。'
  }
  if (b.conditionDetails !== undefined && (typeof b.conditionDetails !== 'string' || b.conditionDetails.length > 1000)) {
    errors.conditionDetails = '体調の詳細は1000文字以内で入力してください。'
  }
  choice('cCardType', CARD_OPTIONS)
  if (typeof b.hasCCard !== 'boolean' || b.hasCCard !== (b.cCardType !== '未取得')) errors.cCardType = 'Cカードの有無・種別を選択してください。'
  choice('cCardOrg', ORG_OPTIONS, true)
  if (b.hasCCard === false && b.cCardOrg !== '' && b.cCardOrg !== undefined) errors.cCardOrg = '未取得の場合は認定団体を空欄にしてください。'
  choice('lastDivePeriod', DIVE_OPTIONS)
  if (b.totalDives !== null && b.totalDives !== undefined &&
      (typeof b.totalDives !== 'number' || !Number.isSafeInteger(b.totalDives) || b.totalDives < 0)) {
    errors.totalDives = '総本数は0以上の整数で入力してください。'
  }
  return errors
}

/** Only call after validation. Clear obsolete/hidden values before persisting. */
export function normalizeQuestionnaireExperience<T extends Record<string, unknown>>(b: T) {
  return { ...b, sleepHours: null, lastDiveDate: '', totalDives: b.totalDives ?? null,
    cCardOrg: b.hasCCard ? (b.cCardOrg ?? '') : '',
    conditionDetails: b.condition === 'bad' ? (b.conditionDetails as string).trim() : '' }
}
