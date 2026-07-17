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
  icon: string
}
