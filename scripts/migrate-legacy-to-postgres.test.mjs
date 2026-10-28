import { describe, expect, it } from 'vitest'
import { buildRows, enqueueImportedSheetsProjections, validateRelations } from './migrate-legacy-to-postgres.mjs'

const source = () => ({
  customers: [{ id: 'C-1', visitCount: 0 }],
  reservations: [{
    id: 'R-1', diveDate: '2026-10-28', guestCount: 1, customerId: 'C-1',
    questionnaireId: 'Q-1', publicRequestKey: 'key-1', cancellationPhase: 'after',
    cancelledAt: '2026-10-28T10:00:00.000Z', cancellationReason: '悪天候',
  }],
  questionnaires: [{ id: 'Q-1', reservationId: 'R-1', submittedAt: '2026-10-28T09:00:00.000Z' }],
  roster: [{
    id: 'N-1', diveDate: '2026-10-28', reservationId: 'R-1', questionnaireId: 'Q-1',
    customerId: 'C-1', age: 30, checkedInAt: '2026-10-28T09:30:00.000Z', checkInMethod: 'QR読取',
  }],
  reservationEmails: [{
    id: 'E-1', reservationId: 'R-1', requestKey: 'key-1', recipientEmail: 'guest@example.com',
    diveDate: '2026-10-28', guestCount: 1, status: 'sent', attemptCount: 1,
    availableAt: '2026-10-28T08:00:00.000Z', createdAt: '2026-10-28T08:00:00.000Z',
    sentAt: '2026-10-28T08:01:00.000Z',
  }],
})

describe('legacy PostgreSQL import', () => {
  it('preserves cancellation details, roster and receipt delivery state', () => {
    const issues = []
    const warnings = []
    const rows = buildRows(source(), 'json', issues)
    validateRelations(rows, issues, warnings)

    expect(issues).toEqual([])
    expect(rows.reservations[0]).toMatchObject({
      public_request_key: 'key-1', cancellation_phase: 'after',
      cancelled_at: '2026-10-28T10:00:00.000Z', cancellation_reason: '悪天候',
    })
    expect(rows.roster[0]).toMatchObject({
      reservation_id: 'R-1', questionnaire_id: 'Q-1', checked_in_at: '2026-10-28T09:30:00.000Z',
    })
    expect(rows.reservationEmails[0]).toMatchObject({
      request_key: 'key-1', status: 'sent', attempt_count: 1,
      sent_at: '2026-10-28T08:01:00.000Z',
    })
  })

  it('rejects inconsistent receipt and roster references before writing', () => {
    const input = source()
    input.roster[0].questionnaireId = 'Q-missing'
    input.reservationEmails[0].requestKey = 'different-key'
    const issues = []
    const rows = buildRows(input, 'json', issues)
    validateRelations(rows, issues, [])

    expect(issues.map((issue) => issue.reason)).toContain('missing_questionnaire_reference')
    expect(issues.map((issue) => issue.reason)).toContain('request_key_mismatch')
  })

  it('queues the imported JSON projections for Sheets in the same transaction', async () => {
    const calls = []
    const client = { query: async (sql, values) => calls.push({ sql, values }) }
    const rows = buildRows(source(), 'json', [])
    await enqueueImportedSheetsProjections(client, rows)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('INSERT INTO sheets_outbox')
    expect(calls[0].values).toEqual([
      'customer', 'C-1', 'upsert',
      'reservation', 'R-1', 'upsert',
      'questionnaire', 'Q-1', 'upsert',
      'roster', 'N-1', 'upsert',
    ])
  })
})
