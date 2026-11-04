/**
 * コレクションの保存先: その端末のブラウザの中（IndexedDB）。サーバーには送らない。
 * テストでは、IDBFactory を差し替えて使う（fake-indexeddb）。
 */
import {
  CollectionError,
  validateNewEntry,
  type CollectionEntry,
} from './collection'

const DB_NAME = 'okidive-fish-collection'
const DB_VERSION = 1
const STORE = 'entries'

export type NewEntryInput = Pick<CollectionEntry, 'speciesId' | 'source' | 'topProbability' | 'photo'>

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('保存先の操作に失敗しました'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('保存に失敗しました'))
    tx.onabort = () => reject(tx.error ?? new Error('保存が中断されました'))
  })
}

export class CollectionStore {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        this.db = null
        reject(req.error ?? new Error('この端末では、コレクションを保存できません'))
      }
      req.onblocked = () => reject(new Error('コレクションを開けませんでした。ほかのタブを閉じてください。'))
    })
    return this.db
  }

  async list(): Promise<CollectionEntry[]> {
    const db = await this.open()
    return request<CollectionEntry[]>(db.transaction(STORE).objectStore(STORE).getAll())
  }

  async count(): Promise<number> {
    const db = await this.open()
    return request(db.transaction(STORE).objectStore(STORE).count())
  }

  /** 1件追加する。上限・種類・写真の大きさを確かめてから保存し、できた記録を返す。 */
  async add(input: NewEntryInput): Promise<CollectionEntry> {
    const db = await this.open()
    validateNewEntry(input, await this.count())
    const entry: CollectionEntry = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      speciesId: input.speciesId,
      source: input.source,
      topProbability: input.topProbability,
      photo: input.photo,
    }
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).add(entry)
      await done(tx)
    } catch (error) {
      // 端末の空き容量が足りないとき
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new CollectionError('PHOTO_TOO_LARGE', '端末の空き容量が足りず、保存できませんでした。')
      }
      throw error
    }
    return entry
  }

  async remove(id: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await done(tx)
  }

  async clear(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await done(tx)
  }

  /** 開いている接続を閉じる（テストの後始末用）。 */
  async close(): Promise<void> {
    if (!this.db) return
    const db = await this.db
    db.close()
    this.db = null
  }
}

/** ブラウザで、IndexedDB が使えるか（プライベートモードなどで、使えないことがある）。 */
export function isCollectionSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * ブラウザに「このデータは消さないで」とお願いする（容量が足りなくなったときに、勝手に消されにくくなる）。
 * 認められなくても、保存は続ける。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
