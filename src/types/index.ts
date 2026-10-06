export interface Reservation {
  id: string
  date: string        // YYYY-MM-DD
  time: string        // HH:MM
  course: string
  guestName: string
  guestCount: number
  phone: string
  channel: 'hp' | 'email' | 'phone' | 'ota' | 'sns' | 'google_form'
  status: 'confirmed' | 'pending' | 'cancelled'
  questionnaireId?: string
  notes?: string
}

export interface QuestionnaireData {
  id: string
  reservationId: string
  submittedAt: string
  /** 旧データには存在しないため、保存時に付与される項目は任意 */
  customerId?: string
  // 基本情報
  lastName: string
  firstName: string
  lastNameKana: string
  firstNameKana: string
  birthDate: string
  gender: 'male' | 'female' | 'other'
  postalCode?: string
  address: string
  phone: string
  email?: string
  emergencyName: string
  emergencyRelation: string
  emergencyPhone: string
  // 健康状態
  heartDisease: boolean
  highBloodPressure?: boolean
  respiratoryDisease: boolean
  earDisease: boolean
  epilepsy: boolean
  diabetes: boolean
  pregnant: boolean
  panicDisorder: boolean
  medication: boolean
  medicationName: string
  latexAllergy: boolean
  // 当日体調
  sleepHours: number
  alcoholLastNight: boolean
  alcoholToday: boolean
  condition: 'good' | 'normal' | 'bad'
  conditionDetails?: string
  // フライト予定
  flightWithin48h: boolean
  // 経験・スキル
  hasCCard: boolean
  cCardType: string
  cCardOrg: string
  lastDiveDate: string
  totalDives: number
  // 同意
  agreeRisk: boolean
  agreeMedical: boolean
  agreePhoto: boolean
  consentAt?: string
  qrToken?: string
  qrExpiresAt?: string
  qrUsed?: boolean
  doctorDivingPermit?: string
  staffReviewStatus?: string
  staffReviewNotes?: string
}

/** 検索候補に表示し、健康情報を含めない一覧用データ */
export type QuestionnaireSummary = Pick<
  QuestionnaireData,
  'id' | 'reservationId' | 'submittedAt' | 'lastName' | 'firstName' |
  'lastNameKana' | 'firstNameKana' | 'phone'
>

/** ゲストが入力する項目。ID・顧客紐付け・QR情報はサーバー側で設定する。 */
export type QuestionnaireFormData = Omit<
  QuestionnaireData,
  | 'id'
  | 'reservationId'
  | 'submittedAt'
  | 'customerId'
  | 'consentAt'
  | 'qrToken'
  | 'qrExpiresAt'
  | 'qrUsed'
  | 'doctorDivingPermit'
  | 'staffReviewStatus'
  | 'staffReviewNotes'
>

export interface Customer {
  id: string
  lastName: string
  firstName: string
  lastNameKana: string
  firstNameKana: string
  phone: string
  email: string
  lastVisit: string
  visitCount: number
  hasCCard: boolean
  cCardType: string
  totalDives: number
  healthNotes: string
  guideNotes: string
  registeredAt?: string
  updatedAt?: string
  /** 問診票の再送で来店回数を重複加算しないための処理済みID一覧 */
  countedQuestionnaireIds?: string
  birthDate?: string
  gender?: QuestionnaireData['gender'] | 'undisclosed'
  postalCode?: string
  address?: string
  emergencyName?: string
  emergencyRelation?: string
  emergencyPhone?: string
  cCardOrg?: string
  lastDiveDate?: string
  dmConsent?: string
}

export interface WeatherDay {
  date: string
  weather: string
  wind: string
  wave: string
  icon: string
}
