import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { isSheetsConfigured, upsertSheetProjection, type SheetsProjectionEntity } from './sheets'
import { query, withTransaction } from './db'
import { getLatestSheetsProjection, requeueLatestSheetsProjection } from './postgresStore'

const CLAIM_LIMIT = 1
const LEASE_SECONDS = 10 * 60
const SHEETS_REQUEST_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 12

interface OutboxRow extends QueryResultRow {
  id: string
  entity_type: SheetsProjectionEntity
  entity_id: string
  operation: 'upsert' | 'delete'
  attempt_count: number
  lease_token: string
}

export interface SheetsOutboxRunResult {
  claimed: number
  delivered: number
  failed: number
  deadLettered: number
  requeued: number
}

async function claimBatch(): Promise<OutboxRow[]> {
  const leaseToken = randomUUID()
  return withTransaction(async (client) => {
    const result = await client.query<OutboxRow>(
      `WITH candidates AS (
         SELECT candidate_event.id
         FROM sheets_outbox candidate_event
         WHERE candidate_event.delivered_at IS NULL
           AND candidate_event.dead_lettered_at IS NULL
           AND candidate_event.available_at <= now()
           AND (candidate_event.locked_until IS NULL OR candidate_event.locked_until <= now())
           AND NOT EXISTS (
             SELECT 1
             FROM sheets_outbox older
             WHERE older.entity_type = candidate_event.entity_type
               AND older.entity_id = candidate_event.entity_id
               AND older.id < candidate_event.id
               AND older.delivered_at IS NULL
               AND older.dead_lettered_at IS NULL
           )
         ORDER BY candidate_event.id
         LIMIT $1
         FOR UPDATE OF candidate_event SKIP LOCKED
       )
       UPDATE sheets_outbox event
       SET locked_until = now() + ($2 * interval '1 second'),
           lease_token = $3,
           attempt_count = event.attempt_count + 1,
           last_attempt_at = now()
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.id, event.entity_type, event.entity_id, event.operation,
                 event.attempt_count, event.lease_token`,
      [CLAIM_LIMIT, LEASE_SECONDS, leaseToken],
    )
    return result.rows
  })
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(60 * 60, 15 * 2 ** Math.min(Math.max(attempt - 1, 0), 8))
}

async function markDelivered(event: OutboxRow): Promise<boolean> {
  const result = await query(
    `UPDATE sheets_outbox
     SET delivered_at = now(), locked_until = NULL, lease_token = NULL, last_error = NULL
     WHERE id = $1 AND lease_token = $2 AND delivered_at IS NULL`,
    [event.id, event.lease_token],
  )
  return Boolean(result.rowCount)
}

async function markFailed(event: OutboxRow, error: unknown): Promise<boolean> {
  // Error messages can contain request data; persist only a safe class identifier.
  const rawErrorName = error instanceof Error ? error.name : ''
  const errorKind = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(rawErrorName) ? rawErrorName : 'UnknownError'
  const result = await query(
    `UPDATE sheets_outbox
     SET available_at = CASE WHEN attempt_count >= $1 THEN available_at
                             ELSE now() + ($2 * interval '1 second') END,
         locked_until = NULL,
         lease_token = NULL,
         last_error = $3,
         dead_lettered_at = CASE WHEN attempt_count >= $1 THEN now() ELSE NULL END
     WHERE id = $4 AND lease_token = $5 AND delivered_at IS NULL
     RETURNING dead_lettered_at`,
    [MAX_ATTEMPTS, retryDelaySeconds(event.attempt_count), errorKind, event.id, event.lease_token],
  )
  return Boolean(result.rows[0]?.dead_lettered_at)
}

async function deliver(event: OutboxRow): Promise<void> {
  if (event.operation !== 'upsert') throw new Error('UnsupportedOperation')
  const projection = await getLatestSheetsProjection(event.entity_type, event.entity_id)
  if (!projection) throw new Error('ProjectionEntityNotFound')
  if (projection.id !== event.entity_id) throw new Error('ProjectionIdMismatch')
  await upsertSheetProjection(
    event.entity_type,
    projection as unknown as Record<string, unknown>,
    { timeoutMs: SHEETS_REQUEST_TIMEOUT_MS },
  )
}

/** Claim one reference, fetch current Postgres state, sync it, and retry failures with backoff. */
export async function runSheetsOutboxWorker(): Promise<SheetsOutboxRunResult> {
  if (!isSheetsConfigured()) throw new Error('Google Sheets credentials are not configured')
  const events = await claimBatch()
  const result: SheetsOutboxRunResult = {
    claimed: events.length,
    delivered: 0,
    failed: 0,
    deadLettered: 0,
    requeued: 0,
  }

  for (const event of events) {
    try {
      await deliver(event)
      if (await markDelivered(event)) {
        result.delivered += 1
      } else if (await requeueLatestSheetsProjection(event.entity_type, event.entity_id)) {
        result.requeued += 1
      } else {
        result.failed += 1
      }
    } catch (error) {
      result.failed += 1
      try {
        if (await markFailed(event, error)) result.deadLettered += 1
      } catch {
        // Lease expiry makes the event eligible again if the database is unavailable here.
      }
    }
  }

  return result
}
