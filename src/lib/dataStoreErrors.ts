export type DataStoreErrorCode = 'reservation_not_found' | 'questionnaire_expired' | 'submission_conflict'

/** Raised when a PostgreSQL row changed after the caller read its expected version. */
export class DataStoreConflictError extends Error {
  constructor() {
    super('The record was updated by another request')
    this.name = 'DataStoreConflictError'
  }
}

export class DataStoreError extends Error {
  constructor(public readonly code: DataStoreErrorCode) {
    super(code)
    this.name = 'DataStoreError'
  }
}
