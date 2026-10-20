import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

const context = new AsyncLocalStorage<boolean>()
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))
export class StoreBusyError extends Error {}

/** 全ストア共通の書込ロック。期限で強制解除しない（遅い書込との競合を防ぐ）。 */
export async function withStoreWriteLock<T>(
  work: () => Promise<T>
): Promise<T> {
  if (context.getStore()) return work()
  const owner = randomUUID()
  const sheets = !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SPREADSHEET_ID
  )
  let release: () => Promise<void>
  if (sheets) {
    const { google } = await import('googleapis')
    const project = process.env.GOOGLE_DATASTORE_LOCK_PROJECT_ID
    if (!project)
      throw new StoreBusyError(
        'Sheetsへの書込には GOOGLE_DATASTORE_LOCK_PROJECT_ID の設定が必要です'
      )
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/datastore'],
    })
    const firestore = google.firestore({ version: 'v1', auth })
    const parent = `projects/${project}/databases/(default)/documents`
    const name = `${parent}/odpLocks/write`
    const deadline = Date.now() + 10000
    for (;;) {
      try {
        await firestore.projects.databases.documents.createDocument({
          parent,
          collectionId: 'odpLocks',
          documentId: 'write',
          requestBody: {
            fields: {
              owner: { stringValue: owner },
              acquiredAt: { timestampValue: new Date().toISOString() },
            },
          },
        })
        break
      } catch (err) {
        const code = (err as { code?: number }).code
        if (code !== 409) throw err
        if (Date.now() >= deadline)
          throw new StoreBusyError(
            '保存処理中です。時間をおいて再度お試しください。'
          )
        await wait(100)
      }
    }
    release = async () => {
      await firestore.projects.databases.documents.delete({ name })
    }
  } else {
    const directory =
      process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data')
    await fs.mkdir(directory, { recursive: true })
    const lockPath = path.join(directory, '.write-lock')
    const deadline = Date.now() + 10000
    for (;;) {
      try {
        await fs.mkdir(lockPath)
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        if (Date.now() >= deadline)
          throw new StoreBusyError(
            '保存処理中です。時間をおいて再度お試しください。'
          )
        await wait(30)
      }
    }
    try {
      await fs.writeFile(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ owner, acquiredAt: new Date().toISOString() }),
        'utf8'
      )
    } catch (err) {
      await fs.rmdir(lockPath)
      throw err
    }
    release = async () => {
      await fs.unlink(path.join(lockPath, 'owner.json'))
      await fs.rmdir(lockPath)
    }
  }
  try {
    return await context.run(true, work)
  } finally {
    await release()
  }
}
