import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('DATABASE_URL is required to run database migrations.')
  process.exit(1)
}

const migrationsDirectory = path.resolve(process.cwd(), 'db', 'migrations')
const migrationNamePattern = /^\d+_[a-z0-9_-]+\.sql$/i
const client = new Client({ connectionString })
let lockAcquired = false

try {
  await client.connect()
  await client.query('SELECT pg_advisory_lock($1, $2)', [1902592026, 1])
  lockAcquired = true
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => migrationNamePattern.test(name))
    .sort()

  for (const version of migrationFiles) {
    const alreadyApplied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [version]
    )
    if (alreadyApplied.rowCount) continue

    const sql = await readFile(path.join(migrationsDirectory, version), 'utf8')
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
      await client.query('COMMIT')
      console.log(`Applied ${version}`)
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Keep the migration error as the reported failure.
      }
      throw error
    }
  }
} catch {
  console.error('Database migration failed; the active migration was rolled back.')
  process.exitCode = 1
} finally {
  if (lockAcquired) {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [1902592026, 1])
    } catch {
      // Closing the client releases a session-level advisory lock as well.
    }
  }
  await client.end().catch(() => {})
}
