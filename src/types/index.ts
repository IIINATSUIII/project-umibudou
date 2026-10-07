export type ReservationTimeSlot = 'morning' | 'afternoon' | 'full' | 'unspecified'
export type ReservationChannel = 'hp' | 'email' | 'phone' | 'ota' | 'sns' | 'google_form'

/** 正準予約データ。旧API/シート名は ReservationInput の境界変換で吸収する。 */
export interface Reservation {
  id: string
  createdAt?: string
  updatedAt?: string
  customerId?: string
  guestName: string
  guestPhone: string
  guestEmail?: string
  /** ダイビング日 YYYY-MM-DD */
  diveDate: string
  /** 旧フォームが指定した正確な HH:MM。Issue #5 の時間帯とは別に保持する。 */
  time?: string
  timeSlot: ReservationTimeSlot
  courseId?: string
  /** 自由記述コース名。コースIDへ一意に解決できない場合も保持する。 */
  courseName: string
  guestCount: number
  status: string
  staffId?: string
  staffName?: string
  channel: ReservationChannel
  questionnaireId?: string
  /** 同一予約の複数参加者の問診票IDを保持。区切り文字は | */
  questionnaireIds?: string
  questionnaireToken?: string
  questionnaireTokenExpiresAt?: string
  questionnaireCompleted?: boolean
  /** Main's normalized storage alias; `time` remains accepted for legacy callers. */
  legacyTime?: string
  legacyChannel?: string
  divePoint?: string
  staffNote?: string
}

/** 旧 date/course/phone/notes 入力を許す移行期間中のAPI境界型。 */
export type ReservationInput = Partial<Reservation> & {
  date?: string
  course?: string
  phone?: string
  notes?: string
}

/** コースマスタ（Courses シート） */
export interface Course {
  id: string    // コースID: "CRS-" + 連番3桁
  name: string
  type: string
}

/** スタッフマスタ（Staff シート） */
export interface Staff {
  id: string    // スタッフID: "STF-" + 連番3桁
  name: string
  isAdmin: boolean
}

/** ステータスマスタ（Status シート） */
export interface StatusDef {
  id: string    // ステータスID: "STS-" + 連番2桁
  name: string
  color: string // 条件付き書式の表示色（#RRGGBB）
}

export interface QuestionnaireData {
  id: string
  reservationId: string
  submittedAt: string
  /** 旧データには存在しないため、保存時に付与される項目は任意 */
  customerId?: string
  /** 同じフォーム送信の再試行を識別するクライアント生成ID */
  submissionId?: string
  // 基本情報
  lastName: string
  firstName: string
  lastNameKana: string
  firstNameKana: string
  birthDate: string
  gender: 'male' | 'female' | 'other' | 'unanswered'
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
  hypertension?: boolean
  medicalCertificate?: boolean
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
  sleepHours: number | null
  sleepCategory?: string
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
  lastDivePeriod?: string
  totalDives: number | null
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
  doctorClearance?: '持参あり' | 'なし' | ''
  staffCheckStatus?: '未確認' | '要対応' | '確認済'
  staffCheckNote?: string
  qrIssuedAt?: string
  submissionState?: 'pending' | 'complete'
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
  | 'submissionId'
  | 'consentAt'
  | 'qrToken'
  | 'qrExpiresAt'
  | 'qrUsed'
  | 'doctorDivingPermit'
  | 'staffReviewStatus'
  | 'staffReviewNotes'
  | 'doctorClearance'
  | 'staffCheckStatus'
  | 'staffCheckNote'
  | 'qrIssuedAt'
  | 'submissionState'
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
  totalDives: number | null
  healthNotes: string
  guideNotes: string
  registeredAt?: string
  createdAt?: string
  updatedAt?: string
  /** 同一予約の再送で来店回数を重複加算しないための処理済み予約ID一覧 */
  countedReservationIds?: string
  /** 旧形式の処理済み問診ID一覧。読み取り時に予約IDへ変換する */
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
  lastDivePeriod?: string
  dmConsent?: string | boolean
}

export interface WeatherDay {
  date: string
  weather: string
  wind: string
  wave: string
  icon: string
  tempHigh?: string
  tempLow?: string
}

export interface RosterEntry {
  id: string
  diveDate: string
  reservationId: string
  questionnaireId: string
  customerId: string
  name: string
  nameKana: string
  birthDate: string
  age: number
  gender: string
  address: string
  phone: string
  emergencyContact: string
  emergencyPhone: string
  course: string
  staffName: string
  checkedInAt: string
  checkInMethod: 'QR読取' | '手動照合'
}
