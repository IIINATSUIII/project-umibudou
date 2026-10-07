export type DataStoreErrorCode = 'reservation_not_found' | 'questionnaire_expired' | 'submission_conflict'

export class DataStoreError extends Error {
  constructor(public readonly code: DataStoreErrorCode) {
    super(code)
    this.name = 'DataStoreError'
  }
}
