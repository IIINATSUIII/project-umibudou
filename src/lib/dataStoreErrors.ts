export type DataStoreErrorCode =
  | 'reservation_not_found'
  | 'questionnaire_expired'
  | 'submission_conflict'
  | 'reservation_guest_limit'

export class DataStoreError extends Error {
  constructor(public readonly code: DataStoreErrorCode) {
    super(code)
    this.name = 'DataStoreError'
  }
}
