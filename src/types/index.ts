export interface Reservation {
  id: string
  date: string        // YYYY-MM-DD
  time: string        // HH:MM
  course: string
  guestName: string
  guestCount: number
  phone: string
  channel: 'hp' | 'email' | 'phone' | 'ota' | 'sns'
  status: 'confirmed' | 'pending' | 'cancelled'
  questionnaireId?: string
  notes?: string
}

export interface QuestionnaireData {
  id: string
  reservationId: string
  /** 顧客自動登録で採番・照合した顧客ID（詳細設計書 5-3-3 No.4 の書き戻し） */
  customerId?: string
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
  /** 顧客台帳のユニークキー（詳細設計書 4-4 顧客自動登録） */
  email: string
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
  /** 初回登録日時（ISO 8601）。顧客自動登録で記録する（詳細設計書 5-3-1 No.2） */
  createdAt?: string
  /** 最終更新日時（ISO 8601）。顧客情報編集・顧客自動登録で更新される（詳細設計書 5-3-1 No.3） */
  updatedAt?: string

  // ─── 問診票から自動登録される項目（詳細設計書 5-3-1 No.8〜20） ───
  // 顧客自動登録の実装（#24）より前に作られた行には存在しないため任意扱いとする。
  /** 生年月日（YYYY-MM-DD）。年齢は本項目から算出する */
  birthDate?: string
  gender?: 'male' | 'female' | 'other'
  address?: string
  emergencyName?: string
  emergencyRelation?: string
  emergencyPhone?: string
  /** 認定団体（PADI／NAUI／SSI／BSAC／その他） */
  cCardOrg?: string
  /** 最終ダイブ日（問診票の「最後にダイビングした時期」） */
  lastDiveDate?: string
}

export interface WeatherDay {
  date: string
  weather: string
  wind: string
  wave: string
  icon: string
}
