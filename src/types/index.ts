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
  channel: 'hp' | 'email' | 'phone' | 'ota' // 予約取込元
  questionnaireToken?: string          // 問診票URL用トークン
  questionnaireTokenExpiresAt?: string // 問診票URL有効期限（ダイブ日翌日0時まで）
  questionnaireCompleted: boolean      // 問診完了フラグ
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
  // 基本情報
  lastName: string
  firstName: string
  lastNameKana: string
  firstNameKana: string
  birthDate: string
  gender: 'male' | 'female' | 'other'
  address: string
  phone: string
  emergencyName: string
  emergencyRelation: string
  emergencyPhone: string
  // 健康状態
  heartDisease: boolean
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
}

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
}

export interface WeatherDay {
  date: string
  weather: string
  wind: string
  wave: string
  tempHigh: string
  tempLow: string
  icon: string
}
