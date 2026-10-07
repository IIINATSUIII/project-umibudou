/**
 * PostgreSQL 接続プール（サーバーサイド専用）。
 * API Route から利用する場合は Node.js runtime を指定すること。
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { attachDatabasePool } from '@vercel/functions'

const globalForPostgres = globalThis as typeof globalThis & {
  umibudouPostgresPool?: Pool
}

function getPool(): Pool {
  if (globalForPostgres.umibudouPostgresPool) {
    return globalForPostgres.umibudouPostgresPool
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to use the PostgreSQL datastore')
  }

  const pool = new Pool({
    connectionString,
    // Vercel の各 Function インスタンスでは接続数を抑え、再利用する。
    max: process.env.VERCEL ? 1 : 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
  if (process.env.VERCEL) attachDatabasePool(pool)

  // 放置中の接続エラーを未処理イベントにせず、接続情報をログへ出さない。
  pool.on('error', () => {
    console.error('Unexpected error from an idle PostgreSQL connection')
  })

  globalForPostgres.umibudouPostgresPool = pool
  return pool
}

export function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: readonly unknown[]
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(text, values as unknown[] | undefined)
}

/** 複数テーブルを更新する処理を同一接続・同一トランザクションで実行する。 */
export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect()
  let discardClient = false
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // 元の処理エラーを維持する。
      discardClient = true
    }
    throw error
  } finally {
    client.release(discardClient)
  }
}
