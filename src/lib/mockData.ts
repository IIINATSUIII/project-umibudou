import type { Reservation, Customer, QuestionnaireData } from '@/types'

// ─── 予約データ ────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

export const MOCK_RESERVATIONS: Reservation[] = [
  {
    id: 'R001',
    date: today,
    time: '09:00',
    course: '体験ダイビング',
    guestName: '田中 花子',
    guestCount: 2,
    phone: '090-1234-5678',
    channel: 'hp',
    status: 'confirmed',
    questionnaireId: 'Q001',
    notes: 'カップル。写真希望あり',
  },
  {
    id: 'R002',
    date: today,
    time: '13:00',
    course: 'ファンダイビング（2本）',
    guestName: '鈴木 太郎',
    guestCount: 1,
    phone: '080-9876-5432',
    channel: 'phone',
    status: 'confirmed',
    notes: 'AOW 総本数150本',
  },
  {
    id: 'R003',
    date: today,
    time: '09:30',
    course: '体験ダイビング',
    guestName: '山田 家族',
    guestCount: 3,
    phone: '070-1111-2222',
    channel: 'ota',
    status: 'pending',
  },
  {
    id: 'R004',
    date: tomorrow,
    time: '09:00',
    course: 'ナイトダイビング',
    guestName: '佐藤 一郎',
    guestCount: 2,
    phone: '090-3333-4444',
    channel: 'sns',
    status: 'confirmed',
    questionnaireId: 'Q002',
  },
]

// ─── 問診票データ ───────────────────────────────────────────
export const MOCK_QUESTIONNAIRES: QuestionnaireData[] = [
  {
    id: 'Q001',
    reservationId: 'R001',
    submittedAt: new Date().toISOString(),
    lastName: '田中',
    firstName: '花子',
    lastNameKana: 'タナカ',
    firstNameKana: 'ハナコ',
    birthDate: '1995-06-15',
    gender: 'female',
    address: '東京都渋谷区',
    phone: '090-1234-5678',
    emergencyName: '田中 太郎',
    emergencyRelation: '夫',
    emergencyPhone: '090-0000-0001',
    heartDisease: false,
    respiratoryDisease: false,
    earDisease: false,
    epilepsy: false,
    diabetes: false,
    pregnant: false,
    panicDisorder: false,
    medication: false,
    medicationName: '',
    latexAllergy: false,
    sleepHours: 7,
    alcoholLastNight: false,
    alcoholToday: false,
    condition: 'good',
    flightWithin48h: false,
    hasCCard: false,
    cCardType: '',
    cCardOrg: '',
    lastDiveDate: '',
    totalDives: 0,
    agreeRisk: true,
    agreeMedical: true,
    agreePhoto: true,
  },
  {
    id: 'Q002',
    reservationId: 'R004',
    submittedAt: new Date(Date.now() - 3600000).toISOString(),
    lastName: '佐藤',
    firstName: '一郎',
    lastNameKana: 'サトウ',
    firstNameKana: 'イチロウ',
    birthDate: '1988-03-22',
    gender: 'male',
    address: '大阪府大阪市',
    phone: '090-3333-4444',
    emergencyName: '佐藤 美子',
    emergencyRelation: '妻',
    emergencyPhone: '080-5555-6666',
    heartDisease: false,
    respiratoryDisease: false,
    earDisease: true,
    epilepsy: false,
    diabetes: false,
    pregnant: false,
    panicDisorder: false,
    medication: false,
    medicationName: '',
    latexAllergy: false,
    sleepHours: 6,
    alcoholLastNight: false,
    alcoholToday: false,
    condition: 'good',
    flightWithin48h: false,
    hasCCard: true,
    cCardType: 'AOW',
    cCardOrg: 'PADI',
    lastDiveDate: '2026-03-10',
    totalDives: 150,
    agreeRisk: true,
    agreeMedical: true,
    agreePhoto: false,
  },
]

// ─── 顧客台帳データ ─────────────────────────────────────────
export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: 'C001',
    lastName: '佐藤',
    firstName: '一郎',
    lastNameKana: 'サトウ',
    firstNameKana: 'イチロウ',
    phone: '090-3333-4444',
    email: 'sato@example.com',
    lastVisit: '2026-06-20',
    visitCount: 5,
    hasCCard: true,
    cCardType: 'AOW',
    totalDives: 150,
    healthNotes: '中耳炎の既往あり。耳抜き注意。',
    guideNotes: '慶良間諸島のアーチがお気に入り。水中写真好き。次回はケラマブルー狙いで早朝ダイブを提案。',
  },
  {
    id: 'C002',
    lastName: '田中',
    firstName: '花子',
    lastNameKana: 'タナカ',
    firstNameKana: 'ハナコ',
    phone: '090-1234-5678',
    email: 'tanaka@example.com',
    lastVisit: today,
    visitCount: 1,
    hasCCard: false,
    cCardType: '',
    totalDives: 0,
    healthNotes: '',
    guideNotes: '初ダイビング。カメに感動していた。Cカード取得を検討中とのこと。',
  },
  {
    id: 'C003',
    lastName: '山本',
    firstName: '健太',
    lastNameKana: 'ヤマモト',
    firstNameKana: 'ケンタ',
    phone: '080-7777-8888',
    email: '',
    lastVisit: '2026-05-05',
    visitCount: 12,
    hasCCard: true,
    cCardType: 'Rescue Diver',
    totalDives: 340,
    healthNotes: '特になし',
    guideNotes: '常連。深場好き。マンタシーズンには必ず来店。リクエストはいつも久米島。',
  },
]

// ─── localStorage との同期ユーティリティ ──────────────────────
export function getReservations(): Reservation[] {
  if (typeof window === 'undefined') return MOCK_RESERVATIONS
  const stored = localStorage.getItem('reservations')
  return stored ? JSON.parse(stored) : MOCK_RESERVATIONS
}

export function saveReservations(data: Reservation[]) {
  localStorage.setItem('reservations', JSON.stringify(data))
}

export function getQuestionnaires(): QuestionnaireData[] {
  if (typeof window === 'undefined') return MOCK_QUESTIONNAIRES
  const stored = localStorage.getItem('questionnaires')
  return stored ? JSON.parse(stored) : MOCK_QUESTIONNAIRES
}

export function saveQuestionnaires(data: QuestionnaireData[]) {
  localStorage.setItem('questionnaires', JSON.stringify(data))
}

export function getCustomers(): Customer[] {
  if (typeof window === 'undefined') return MOCK_CUSTOMERS
  const stored = localStorage.getItem('customers')
  return stored ? JSON.parse(stored) : MOCK_CUSTOMERS
}

export function saveCustomers(data: Customer[]) {
  localStorage.setItem('customers', JSON.stringify(data))
}
