import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PoolClient, QueryResultRow } from 'pg'
import { query, withTransaction } from '@/lib/db'
import type { StaffRole } from '@/lib/session'

const PASSWORD_MIN_LENGTH = 5
const PASSWORD_MAX_LENGTH = 256
const DISPLAY_NAME_MAX_LENGTH = 100
const INVITATION_TTL_MS = 24 * 60 * 60 * 1000
const SCRYPT_N = 131072
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 32

export type StaffStatus = 'active' | 'suspended'

export type StaffUser = {
  id: string
  email: string
  displayName: string
  role: StaffRole
  status: StaffStatus
  sessionVersion: number
  lastLoginAt: string | null
}

export type StaffInvitation = {
  id: string
  email: string
  role: StaffRole
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export class StaffAuthDatabaseError extends Error {
  constructor(message = 'Staff auth database is unavailable') {
    super(message)
    this.name = 'StaffAuthDatabaseError'
  }
}

export class DuplicateStaffAccountError extends Error {
  constructor() {
    super('A staff account already exists for this email')
    this.name = 'DuplicateStaffAccountError'
  }
}

export class DuplicateInvitationError extends Error {
  constructor() {
    super('An active invitation already exists for this email')
    this.name = 'DuplicateInvitationError'
  }
}

export class InvalidInvitationError extends Error {
  constructor() {
    super('The invitation is invalid, expired, used, or revoked')
    this.name = 'InvalidInvitationError'
  }
}

export class LastAdminError extends Error {
  constructor() {
    super('The last active administrator cannot be suspended or demoted')
    this.name = 'LastAdminError'
  }
}

type StaffUserRow = QueryResultRow & {
  id: string
  email: string
  display_name: string
  password_hash: string
  role: StaffRole
  status: StaffStatus
  session_version: number
  last_login_at: Date | string | null
}

type InvitationRow = QueryResultRow & {
  id: string
  email: string
  normalized_email: string
  role: StaffRole
  expires_at: Date | string
  used_at: Date | string | null
  revoked_at: Date | string | null
  created_at: Date | string
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapUser(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    sessionVersion: Number(row.session_version),
    lastLoginAt: asIso(row.last_login_at),
  }
}

function mapInvitation(row: InvitationRow): StaffInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: asIso(row.expires_at)!,
    usedAt: asIso(row.used_at),
    revokedAt: asIso(row.revoked_at),
    createdAt: asIso(row.created_at)!,
  }
}

export function hasStaffDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/** DB未起動のローカル開発時だけ、スタッフ認証をJSONへ保存する。 */
export function canUseLocalStaffAuth(): boolean {
  return process.env.NODE_ENV !== 'production'
}

type LocalStaffUser = {
  id: string
  email: string
  displayName: string
  passwordHash: string
  role: StaffRole
  status: StaffStatus
  sessionVersion: number
  lastLoginAt: string | null
}

let localStaffWriteQueue = Promise.resolve()

async function withLocalStaffWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = localStaffWriteQueue
  let release!: () => void
  localStaffWriteQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

function localStaffFile(): string {
  const directory = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data')
  return path.join(directory, 'staff-users.json')
}

async function readLocalStaffUsers(): Promise<LocalStaffUser[]> {
  try {
    const rows: unknown = JSON.parse(await fs.readFile(localStaffFile(), 'utf8'))
    if (!Array.isArray(rows)) throw new StaffAuthDatabaseError('Local staff auth data is invalid')
    return rows as LocalStaffUser[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeLocalStaffUsers(rows: LocalStaffUser[]): Promise<void> {
  const file = localStaffFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  await fs.writeFile(temporary, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  }
}

function mapLocalStaffUser(row: LocalStaffUser): StaffUser {
  return {
    // ローカルフォールバックのセッションをDBセッションとして扱わない。
    id: '',
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    sessionVersion: row.sessionVersion,
    lastLoginAt: row.lastLoginAt,
  }
}

export async function getLocalStaffUserByEmail(email: string): Promise<{ user: StaffUser; passwordHash: string } | null> {
  const row = (await readLocalStaffUsers()).find((item) => item.email.trim().toLowerCase() === normalizeStaffEmail(email))
  return row ? { user: mapLocalStaffUser(row), passwordHash: row.passwordHash } : null
}

export async function createLocalStaffUser(input: {
  email: string
  displayName: string
  password: string
}): Promise<StaffUser> {
  if (!canUseLocalStaffAuth()) throw new StaffAuthDatabaseError('Local staff auth is disabled in production')
  const email = input.email.trim()
  const normalizedEmail = normalizeStaffEmail(email)
  if (!isValidStaffEmail(normalizedEmail)) throw new Error('INVALID_STAFF_EMAIL')
  if (!isValidDisplayName(input.displayName)) throw new Error('INVALID_DISPLAY_NAME')
  const passwordHash = await hashStaffPassword(input.password)
  return withLocalStaffWriteLock(async () => {
    const rows = await readLocalStaffUsers()
    if (rows.some((row) => row.email.trim().toLowerCase() === normalizedEmail)) {
      throw new DuplicateStaffAccountError()
    }
    const user: LocalStaffUser = {
      id: id('LOCAL-STU'),
      email,
      displayName: input.displayName.trim(),
      passwordHash,
      role: 'staff',
      status: 'active',
      sessionVersion: 0,
      lastLoginAt: null,
    }
    rows.push(user)
    await writeLocalStaffUsers(rows)
    return mapLocalStaffUser(user)
  })
}

export async function touchLocalStaffLogin(email: string): Promise<void> {
  if (!canUseLocalStaffAuth()) return
  await withLocalStaffWriteLock(async () => {
    const rows = await readLocalStaffUsers()
    const row = rows.find((item) => item.email.trim().toLowerCase() === normalizeStaffEmail(email))
    if (!row) return
    row.lastLoginAt = new Date().toISOString()
    await writeLocalStaffUsers(rows)
  })
}

export function normalizeStaffEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidStaffEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isValidDisplayName(name: string): boolean {
  return name.trim().length > 0 && name.length <= DISPLAY_NAME_MAX_LENGTH
}

export function validateStaffPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 256 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key as Buffer))
  })
}

export async function hashStaffPassword(password: string): Promise<string> {
  if (!validateStaffPassword(password)) throw new Error('Password does not meet the minimum requirements')
  const salt = randomBytes(16)
  const key = await deriveKey(password, salt)
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyStaffPassword(password: string, encoded: string): Promise<boolean> {
  if (!validateStaffPassword(password)) return false
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1]); const r = Number(parts[2]); const p = Number(parts[3])
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false
  try {
    const salt = Buffer.from(parts[4], 'base64url')
    const expected = Buffer.from(parts[5], 'base64url')
    const actual = await deriveKey(password, salt)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function id(prefix: string): string {
  return `${prefix}-${randomBytes(12).toString('hex')}`
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function ensureDatabase(): void {
  if (!hasStaffDatabase()) throw new StaffAuthDatabaseError('DATABASE_URL is not configured')
}

export async function getStaffUserById(userId: string): Promise<StaffUser | null> {
  ensureDatabase()
  const result = await query<StaffUserRow>(
    `SELECT id, email, display_name, password_hash, role, status, session_version, last_login_at
       FROM staff_users WHERE id = $1`, [userId]
  )
  return result.rows[0] ? mapUser(result.rows[0]) : null
}

export async function getStaffUserByEmail(email: string): Promise<{ user: StaffUser; passwordHash: string } | null> {
  ensureDatabase()
  const result = await query<StaffUserRow>(
    `SELECT id, email, display_name, password_hash, role, status, session_version, last_login_at
       FROM staff_users WHERE normalized_email = $1`, [normalizeStaffEmail(email)]
  )
  return result.rows[0] ? { user: mapUser(result.rows[0]), passwordHash: result.rows[0].password_hash } : null
}

export async function ensureLegacyStaffUser(email: string, password: string): Promise<StaffUser> {
  ensureDatabase()
  const normalizedEmail = normalizeStaffEmail(email)
  const existing = await getStaffUserByEmail(normalizedEmail)
  if (existing) return existing.user
  const passwordHash = await hashStaffPassword(password)
  const role: StaffRole = normalizeStaffEmail(process.env.STAFF_ADMIN_EMAIL ?? '') === normalizedEmail ? 'admin' : 'staff'
  try {
    const result = await query<StaffUserRow>(
      `INSERT INTO staff_users
         (id, email, normalized_email, display_name, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, email, display_name, password_hash, role, status, session_version, last_login_at`,
      [id('STU'), normalizedEmail, normalizedEmail, normalizedEmail, passwordHash, role]
    )
    return mapUser(result.rows[0])
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const raced = await getStaffUserByEmail(normalizedEmail)
      if (raced) return raced.user
    }
    throw error
  }
}

/** 招待なしの公開登録で一般スタッフアカウントを作成する。 */
export async function createStaffUser(input: {
  email: string
  displayName: string
  password: string
}): Promise<StaffUser> {
  ensureDatabase()
  const email = input.email.trim()
  const normalizedEmail = normalizeStaffEmail(email)
  if (!isValidStaffEmail(normalizedEmail)) throw new Error('INVALID_STAFF_EMAIL')
  if (!isValidDisplayName(input.displayName)) throw new Error('INVALID_DISPLAY_NAME')
  const passwordHash = await hashStaffPassword(input.password)
  try {
    const result = await query<StaffUserRow>(
      `INSERT INTO staff_users
         (id, email, normalized_email, display_name, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'staff', 'active')
       RETURNING id, email, display_name, password_hash, role, status, session_version, last_login_at`,
      [id('STU'), email, normalizedEmail, input.displayName.trim(), passwordHash]
    )
    return mapUser(result.rows[0])
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DuplicateStaffAccountError()
    throw error
  }
}

export async function touchStaffLogin(userId: string): Promise<void> {
  ensureDatabase()
  await query('UPDATE staff_users SET last_login_at = now() WHERE id = $1', [userId])
}

function invitationIsUsable(row: InvitationRow): boolean {
  return !row.used_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()
}

export async function findInvitationByToken(token: string): Promise<StaffInvitation | null> {
  ensureDatabase()
  const result = await query<InvitationRow>(
    `SELECT id, email, normalized_email, role, expires_at, used_at, revoked_at, created_at
       FROM staff_invitations WHERE token_hash = $1`, [tokenHash(token)]
  )
  return result.rows[0] ? mapInvitation(result.rows[0]) : null
}

export async function createStaffInvitation(input: { email: string; role: StaffRole; createdBy: string }): Promise<{ invitation: StaffInvitation; token: string }> {
  ensureDatabase()
  const normalizedEmail = normalizeStaffEmail(input.email)
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
  try {
    return await withTransaction(async (client) => {
      // 同じメールへの招待を並行発行しても二重作成しない。
      await client.query('SELECT pg_advisory_xact_lock(1902592026, hashtext($1))', [normalizedEmail])
      const existingUser = await client.query('SELECT 1 FROM staff_users WHERE normalized_email = $1', [normalizedEmail])
      const existingInvitation = await client.query(
        `SELECT 1 FROM staff_invitations
          WHERE normalized_email = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [normalizedEmail]
      )
      if (existingUser.rowCount || existingInvitation.rowCount) throw new DuplicateInvitationError()
      const result = await client.query<InvitationRow>(
        `INSERT INTO staff_invitations
           (id, email, normalized_email, role, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, normalized_email, role, expires_at, used_at, revoked_at, created_at`,
        [id('INV'), normalizedEmail, normalizedEmail, input.role, tokenHash(token), expiresAt, input.createdBy]
      )
      return { invitation: mapInvitation(result.rows[0]), token }
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new DuplicateInvitationError()
    throw error
  }
}

export async function listStaffInvitations(): Promise<StaffInvitation[]> {
  ensureDatabase()
  const result = await query<InvitationRow>(
    `SELECT id, email, normalized_email, role, expires_at, used_at, revoked_at, created_at
       FROM staff_invitations
      WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`
  )
  return result.rows.map(mapInvitation)
}

export async function revokeStaffInvitation(invitationId: string): Promise<boolean> {
  ensureDatabase()
  const result = await query(
    `UPDATE staff_invitations SET revoked_at = now()
      WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [invitationId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function redeemStaffInvitation(input: {
  token: string
  displayName: string
  password: string
}): Promise<StaffUser> {
  ensureDatabase()
  const passwordHash = await hashStaffPassword(input.password)
  return withTransaction(async (client) => {
    const invitationResult = await client.query<InvitationRow>(
      `SELECT id, email, normalized_email, role, expires_at, used_at, revoked_at, created_at
         FROM staff_invitations WHERE token_hash = $1 FOR UPDATE`, [tokenHash(input.token)]
    )
    const invitation = invitationResult.rows[0]
    if (!invitation || !invitationIsUsable(invitation)) throw new InvalidInvitationError()

    const duplicate = await client.query('SELECT 1 FROM staff_users WHERE normalized_email = $1', [invitation.normalized_email])
    if (duplicate.rowCount) throw new DuplicateStaffAccountError()

    try {
      const result = await client.query<StaffUserRow>(
        `INSERT INTO staff_users
           (id, email, normalized_email, display_name, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         RETURNING id, email, display_name, password_hash, role, status, session_version, last_login_at`,
        [id('STU'), invitation.email, invitation.normalized_email, input.displayName.trim(), passwordHash, invitation.role]
      )
      await client.query('UPDATE staff_invitations SET used_at = now() WHERE id = $1', [invitation.id])
      return mapUser(result.rows[0])
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new DuplicateStaffAccountError()
      throw error
    }
  })
}

export async function listStaffUsers(): Promise<StaffUser[]> {
  ensureDatabase()
  const result = await query<StaffUserRow>(
    `SELECT id, email, display_name, password_hash, role, status, session_version, last_login_at
       FROM staff_users ORDER BY display_name ASC, email ASC`
  )
  return result.rows.map(mapUser)
}

export async function updateStaffUser(input: {
  id: string
  role?: StaffRole
  status?: StaffStatus
}): Promise<StaffUser> {
  ensureDatabase()
  return withTransaction(async (client) => {
    const current = await client.query<StaffUserRow>(
      `SELECT id, email, display_name, password_hash, role, status, session_version, last_login_at
         FROM staff_users WHERE id = $1 FOR UPDATE`, [input.id]
    )
    const target = current.rows[0]
    if (!target) throw new Error('STAFF_NOT_FOUND')
    const nextRole = input.role ?? target.role
    const nextStatus = input.status ?? target.status
    if (target.role === 'admin' && target.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active')) {
      const admins = await client.query("SELECT count(*)::int AS count FROM staff_users WHERE role = 'admin' AND status = 'active'")
      if (Number(admins.rows[0]?.count ?? 0) <= 1) throw new LastAdminError()
    }
    const updated = await client.query<StaffUserRow>(
      `UPDATE staff_users
          SET role = $2, status = $3, session_version = session_version + 1
        WHERE id = $1
      RETURNING id, email, display_name, password_hash, role, status, session_version, last_login_at`,
      [input.id, nextRole, nextStatus]
    )
    return mapUser(updated.rows[0])
  })
}

