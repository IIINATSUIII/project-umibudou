import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  reservation: {} as Record<string, unknown>,
  customer: {} as Record<string, unknown>,
  rowLockQueue: Promise.resolve() as Promise<void>,
  updatedTables: [] as string[],
}))

vi.mock('../db', () => ({
  query: vi.fn(),
  withTransaction: async <T>(operation: (client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<T>) => {
    let releaseRowLock: (() => void) | undefined
    try {
      const client = {
        query: async (sql: string, values: unknown[] = []) => {
          if (sql.startsWith('SELECT * FROM reservations WHERE id = $1 FOR UPDATE')) {
            const previous = state.rowLockQueue
            state.rowLockQueue = new Promise<void>((resolve) => { releaseRowLock = resolve })
            await previous
            return { rows: [{ ...state.reservation }], rowCount: 1 }
          }
          if (sql.startsWith('SELECT customers.*')) {
            if (!sql.includes('FOR UPDATE')) throw new Error('Customer update must lock its row')
            const previous = state.rowLockQueue
            state.rowLockQueue = new Promise<void>((resolve) => { releaseRowLock = resolve })
            await previous
            return { rows: [{ ...state.customer, counted_reservation_ids: '[]' }], rowCount: 1 }
          }
          if (sql.startsWith('UPDATE reservations') || sql.startsWith('UPDATE customers')) {
            const table = sql.startsWith('UPDATE reservations') ? 'reservations' : 'customers'
            const row = table === 'reservations' ? state.reservation : state.customer
            const assignments = sql.match(/ SET (.+) WHERE id = \$\d+ RETURNING id$/)?.[1]
            if (!assignments) throw new Error(`Unexpected update SQL: ${sql}`)
            for (const assignment of assignments.split(', ')) {
              const match = assignment.match(/^(\w+) = \$(\d+)$/)
              if (match) row[match[1]] = values[Number(match[2]) - 1]
            }
            state.updatedTables.push(table)
            return { rows: [{ id: values[values.length - 1] }], rowCount: 1 }
          }
          if (sql.startsWith('INSERT INTO sheets_outbox')) return { rows: [], rowCount: 1 }
          throw new Error(`Unexpected query: ${sql}`)
        },
      }
      return await operation(client)
    } finally {
      releaseRowLock?.()
    }
  },
}))

import { updateCustomer, updateReservation } from '../postgresStore'
import { DataStoreConflictError } from '../dataStoreErrors'

const previousVersion = '2026-10-01T00:00:00.000Z'

beforeEach(() => {
  state.reservation = { id: 'R-1', updated_at: previousVersion, dive_date: '2026-10-20', status: 'STS-01' }
  state.customer = { id: 'C-1', updated_at: previousVersion, last_name: '田中', visit_count: 1 }
  state.rowLockQueue = Promise.resolve()
  state.updatedTables = []
})

describe('PostgreSQL version checks under a row lock', () => {
  it('allows only one concurrent reservation update using the same expected version', async () => {
    const results = await Promise.allSettled([
      updateReservation('R-1', { status: 'STS-02', updatedAt: '2026-10-01T00:00:01.000Z' }, previousVersion),
      updateReservation('R-1', { status: 'STS-05', updatedAt: '2026-10-01T00:00:02.000Z' }, previousVersion),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(DataStoreConflictError)
    expect(state.updatedTables).toEqual(['reservations'])
    expect(state.reservation.status).toBe('STS-02')
    expect(state.reservation.updated_at).toBe('2026-10-01T00:00:01.000Z')
  })

  it('allows only one concurrent customer update using the same expected version', async () => {
    const results = await Promise.allSettled([
      updateCustomer('C-1', { lastName: '佐藤', updatedAt: '2026-10-01T00:00:01.000Z' }, previousVersion),
      updateCustomer('C-1', { lastName: '鈴木', updatedAt: '2026-10-01T00:00:02.000Z' }, previousVersion),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(DataStoreConflictError)
    expect(state.updatedTables).toEqual(['customers'])
    expect(['佐藤', '鈴木']).toContain(state.customer.last_name)
    expect(state.customer.updated_at).toBe('2026-10-01T00:00:01.000Z')
  })
})
