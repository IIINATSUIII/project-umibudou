/**
 * 予約一覧（Reservations シート）
 * 列定義は docs/03_基本設計書_DB設計編.md §3-2 に準拠。
 */
export interface Reservation {
  id: string                  // 予約ID: "R-" + YYYYMMDD + 連番3桁
  createdAt: string           // 登録日時（ISO datetime）
  updatedAt: string           // 最終更新日時（排他制御の後勝ち検知に使用）
  customerId?: string         // 顧客ID（顧客台帳を参照。問診送信後に紐づく）
  guestName: string           // 代表者氏名
  guestPhone: string          // 代表者電話番号
  guestEmail: string          // 代表者メールアドレス
  diveDate: string            // ダイブ日 YYYY-MM-DD
  timeSlot: 'morning' | 'afternoon' | 'full' | 'unspecified' // 時間帯
  courseId: string            // コースID（コースマスタを参照）
  courseName: string          // コース名（表示用。コースマスタから転記）
  guestCount: number          // 参加人数
  status: string              // 予約ステータス（ステータスマスタのIDを参照）
  staffId?: string            // 担当スタッフID（スタッフマスタを参照）
  staffName?: string          // 担当スタッフ名（表示用。スタッフマスタから転記）
  channel: 'hp' | 'email' | 'phone' | 'ota' | 'sns' | 'google_form' // 予約取込元
  questionnaireToken?: string          // 問診票URL用トークン
  questionnaireTokenExpiresAt?: string // 問診票URL有効期限（ダイブ日翌日0時まで）
  questionnaireCompleted: boolean      // 問診完了フラグ
  questionnaireId?: string
  legacyTime?: string
  legacyChannel?: string
  divePoint?: string          // ダイブポイント
  staffNote?: string          // スタッフメモ／キャンセル理由
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
