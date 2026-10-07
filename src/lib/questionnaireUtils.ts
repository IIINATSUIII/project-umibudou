import type { QuestionnaireData } from '@/types'

/** 既存の問診票IDを尊重して、次の M-連番4桁を返す。 */
export function nextQuestionnaireId(questionnaires: QuestionnaireData[]): string {
  const maxId = questionnaires.reduce((max, questionnaire) => {
    const match = questionnaire.id.match(/^M-(\d+)$/i)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  if (maxId >= 9999) throw new Error('Questionnaire ID limit reached (M-9999)')
  return `M-${String(maxId + 1).padStart(4, '0')}`
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s　]/g, '')
}

function normalizePhone(value: string): string {
  return value.normalize('NFKC').replace(/\D/g, '')
}

/** ID・予約ID・QRトークン・氏名（漢字/カナ）・電話番号による部分検索。 */
export function matchesQuestionnaire(
  questionnaire: QuestionnaireData,
  query: string
): boolean {
  const rawQuery = query.trim()
  // QRトークンはBase64URLの大文字・小文字を区別する不透明値。
  if (questionnaire.qrToken && questionnaire.qrToken === rawQuery) return true

  const normalizedQuery = normalizeText(query.trim())
  if (!normalizedQuery) return false

  const textFields = [
    questionnaire.id,
    questionnaire.reservationId,
    questionnaire.lastName,
    questionnaire.firstName,
    `${questionnaire.lastName}${questionnaire.firstName}`,
    questionnaire.lastNameKana,
    questionnaire.firstNameKana,
    `${questionnaire.lastNameKana}${questionnaire.firstNameKana}`,
  ]

  if (textFields.some((value) => normalizeText(value).includes(normalizedQuery))) {
    return true
  }

  const queryDigits = normalizePhone(query)
  return queryDigits.length >= 4 && normalizePhone(questionnaire.phone).includes(queryDigits)
}

/** 旧形式の C001 と新形式 C-0001 の両方を見て次の顧客IDを採番する。 */
export function nextCustomerId(customerIds: string[]): string {
  const maxId = customerIds.reduce((max, id) => {
    const match = id.match(/^C-?(\d+)$/i)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  if (maxId >= 9999) throw new Error('Customer ID limit reached (C-9999)')
  return `C-${String(maxId + 1).padStart(4, '0')}`
}
