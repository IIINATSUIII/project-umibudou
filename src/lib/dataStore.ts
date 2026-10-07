/**
 * Primary datastore selection. PostgreSQL is opt-in until data import and cutover
 * are explicitly completed; without DATA_STORE=postgres, legacy selection stays
 * Sheets-if-configured, otherwise local JSON.
 */

import type { Customer, QuestionnaireData, QuestionnaireFormData, Reservation, ReservationInput, RosterEntry } from '@/types'
import * as sheets from './sheets'
import * as local from './localStore'
import * as postgres from './postgresStore'
export { DataStoreError } from './dataStoreErrors'

export interface PublicQuestionnaireSubmission {
  reservationId: string
  reservationToken: string
  submissionId: string
  formData: QuestionnaireFormData
}

export interface StaffQuestionnaireSubmission {
  reservationId: string
  submissionId: string
  formData: QuestionnaireFormData
}

export type PublicQuestionnaireSubmissionResult = {
  status: 'saved' | 'replayed'
  questionnaire: QuestionnaireData
  requiresStaffReview: boolean
}

export type QuestionnaireResolutionResult =
  | { status: 'resolved'; questionnaire: QuestionnaireData }
  | { status: 'not_found' }
  | { status: 'not_pending' }
  | { status: 'customer_not_found' }
  | { status: 'customer_conflict' }

export interface DataStore {
  getReservations(): Promise<Reservation[]>
  addReservation(data: ReservationInput): Promise<Reservation>
  updateReservation(id: string, data: ReservationInput): Promise<void>
  getQuestionnaires(): Promise<QuestionnaireData[]>
  addQuestionnaire(data: Omit<QuestionnaireData, 'id'>): Promise<QuestionnaireData>
  searchQuestionnaires(query: string): Promise<QuestionnaireData[]>
  getQuestionnaireById(id: string): Promise<QuestionnaireData | undefined>
  updateQuestionnaire(id: string, data: Partial<QuestionnaireData>): Promise<QuestionnaireData>
  getCustomers(): Promise<Customer[]>
  searchCustomers(query: string): Promise<Customer[]>
  addCustomer(data: Customer): Promise<void>
  updateCustomer(id: string, data: Partial<Customer>): Promise<void>
  getRoster(): Promise<RosterEntry[]>
  addRoster(data: RosterEntry): Promise<void | RosterEntry>
  /** PostgreSQL provides cross-instance transactional implementations; legacy stores use their existing flow. */
  submitPublicQuestionnaire?(input: PublicQuestionnaireSubmission): Promise<PublicQuestionnaireSubmissionResult>
  /** Staff submissions use the same atomic identity review and linking flow without guest-link expiry checks. */
  submitStaffQuestionnaire?(input: StaffQuestionnaireSubmission): Promise<PublicQuestionnaireSubmissionResult>
  resolveQuestionnaireForCustomer?(questionnaireId: string, customerId: string): Promise<QuestionnaireResolutionResult>
}

export const USE_SHEETS = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY &&
  process.env.GOOGLE_SPREADSHEET_ID
)

const configuredStore = process.env.DATA_STORE
if (configuredStore && !['postgres', 'sheets', 'json'].includes(configuredStore)) {
  throw new Error(`Unsupported DATA_STORE value: ${configuredStore}`)
}

if (configuredStore === 'postgres' && !process.env.DATABASE_URL) {
  throw new Error('DATA_STORE=postgres requires DATABASE_URL; refusing to fall back to a different store')
}

export const USE_POSTGRES = configuredStore === 'postgres'
export const store: DataStore = USE_POSTGRES
  ? postgres
  : configuredStore === 'json'
    ? local
    : configuredStore === 'sheets' || USE_SHEETS
      ? sheets
      : local
