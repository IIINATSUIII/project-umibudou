import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { Reservation } from '@/types'

vi.mock('@/lib/dataStore', async () => ({
  store: await vi.importActual<typeof import('../localStore')>('../localStore'),
  USE_POSTGRES: false,
  DataStoreError: class extends Error {},
}))
vi.mock('@/lib/googleFormImport', () => ({
  importGoogleFormBookings: async () => ({ errors: [] }),
}))
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'odp_session',
  verifySessionToken: async (token: string) => token === 'staff-session' ? { email: 'staff@example.com' } : null,
}))

import { store } from '@/lib/dataStore'
import { GET as listReservations } from '@/app/api/reservations/route'
import { POST as issueUrl, DELETE as revokeUrl } from '@/app/api/reservations/questionnaire-url/route'
import { GET as readQuestionnaire, POST as submitQuestionnaire } from '@/app/api/public/questionnaires/route'
import { POST as readCheckinQr } from '@/app/api/public/checkin-qr/route'
import { deriveReservationQuestionnaireToken } from '../reservationQuestionnaireToken'
import { getQuestionnaireExpiry } from '../questionnaireToken'

let directory: string
const reservationId = 'R-legacy'
const diveDate = '2099-01-01'
const expiry = getQuestionnaireExpiry(diveDate)
const legacyReservation = {
  id: reservationId,
  date: diveDate,
  time: '09:00',
  course: '体験ダイビング',
  guestName: 'テスト 太郎',
  phone: '090-1234-5678',
  guestCount: 1,
  status: 'confirmed',
  channel: 'phone',
  updatedAt: '2026-10-06T00:00:00.000Z',
}

const request = (method: string, body?: unknown, query = '') => new NextRequest(
  'http://localhost/api/reservations' + query,
  {
    method,
    headers: { 'Content-Type': 'application/json', cookie: 'odp_session=staff-session' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  },
)
const read = (token: string) => readQuestionnaire(new NextRequest(
  'http://localhost/api/public/questionnaires?accessToken=' + encodeURIComponent(token),
))
const issue = (reissue = false) => issueUrl(request('POST', { id: reservationId, reissue }))
const revoke = () => revokeUrl(request('DELETE', { id: reservationId }))
const poll = () => listReservations(request('GET'))
const reservationsFile = () => path.join(directory, 'reservations.json')

async function seedIssuedLegacyUrl() {
  const token = deriveReservationQuestionnaireToken(reservationId)
  await fs.writeFile(reservationsFile(), JSON.stringify([{
    ...legacyReservation,
    questionnaireToken: token,
    questionnaireTokenExpiresAt: expiry,
  }]))
  return token
}

async function expectRejected(token: string) {
  expect((await read(token)).status).toBe(404)
  expect((await submitQuestionnaire(request('POST', { accessToken: token }))).status).toBe(404)
  expect((await readCheckinQr(request('POST', {
    reservationId,
    reservationToken: token,
  }))).status).toBe(404)
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odp-url-revocation-'))
  vi.stubEnv('LOCAL_DATA_DIR', directory)
  vi.stubEnv('SESSION_SECRET', 'regression-test-only-secret')
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '')
  vi.stubEnv('GOOGLE_PRIVATE_KEY', '')
  vi.stubEnv('GOOGLE_SPREADSHEET_ID', '')
  await fs.writeFile(reservationsFile(), JSON.stringify([legacyReservation]))
  await fs.writeFile(path.join(directory, 'questionnaires.json'), '[]')
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await fs.rm(directory, { recursive: true, force: true })
})

it('lists legacy reservations without issuing credentials or rewriting the stored file', async () => {
  const before = await fs.readFile(reservationsFile(), 'utf8')
  for (let index = 0; index < 3; index++) {
    const response = await poll()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const rows = await response.json()
    expect(rows[0].questionnaireToken).toBeUndefined()
    expect(rows[0].questionnaireTokenExpiresAt).toBeUndefined()
  }
  expect(await fs.readFile(reservationsFile(), 'utf8')).toBe(before)
  expect(await fs.readdir(directory)).toEqual(expect.not.arrayContaining(['.write-lock', 'reservations.json.before-review-migration']))
  const filtered = await listReservations(request('GET', undefined, '?date=2099-01-02'))
  expect(await filtered.json()).toEqual([])
  await expectRejected(deriveReservationQuestionnaireToken(reservationId))
})

it('issues a random URL for a legacy reservation only on an explicit request', async () => {
  const response = await issue()
  expect(response.status).toBe(200)
  const issued = await response.json()
  expect(Buffer.from(issued.questionnaireToken, 'base64url')).toHaveLength(32)
  expect(issued.questionnaireToken).not.toBe(deriveReservationQuestionnaireToken(reservationId))
  expect(issued.questionnaireTokenExpiresAt).toBe(expiry)
  expect((await read(issued.questionnaireToken)).status).toBe(200)
  expect(await (await issue()).json()).toEqual(issued)
})

it('keeps a previously shared legacy URL revoked after repeated list polling', async () => {
  const token = await seedIssuedLegacyUrl()
  expect((await read(token)).status).toBe(200)
  expect((await readCheckinQr(request('POST', { reservationId, reservationToken: token }))).status).toBe(200)
  expect((await revoke()).status).toBe(200)
  const revoked = await fs.readFile(reservationsFile(), 'utf8')
  await expectRejected(token)
  for (let index = 0; index < 3; index++) {
    expect((await poll()).status).toBe(200)
    await expectRejected(token)
  }
  expect(await fs.readFile(reservationsFile(), 'utf8')).toBe(revoked)
  expect(JSON.parse(revoked)[0]).toMatchObject({ questionnaireToken: '', questionnaireTokenExpiresAt: '' })
})

it('does not infer a missing stored expiry when verifying a legacy reservation code', async () => {
  const token = deriveReservationQuestionnaireToken(reservationId)
  await fs.writeFile(reservationsFile(), JSON.stringify([{
    ...legacyReservation, questionnaireToken: token,
  }]))
  expect((await readCheckinQr(request('POST', { reservationId, reservationToken: token }))).status).toBe(410)
})

it('accepts only the newly issued URL after revocation and reissue', async () => {
  const oldToken = await seedIssuedLegacyUrl()
  expect((await revoke()).status).toBe(200)
  const { questionnaireToken: newToken } = await (await issue(true)).json()
  expect(newToken).not.toBe(oldToken)
  expect(Buffer.from(newToken, 'base64url')).toHaveLength(32)
  for (let index = 0; index < 3; index++) {
    expect((await poll()).status).toBe(200)
    await expectRejected(oldToken)
    expect((await read(newToken)).status).toBe(200)
  }
})

it.each(['reissue', 'revoke'] as const)('does not roll back %s when a pending list read returns its old snapshot', async (action) => {
  const oldToken = deriveReservationQuestionnaireToken(reservationId)
  const originalRead = store.getReservations
  let resolveSnapshot!: (rows: Reservation[]) => void
  let signalRead!: () => void
  const readStarted = new Promise<void>((resolve) => { signalRead = resolve })
  const staleRead = new Promise<Reservation[]>((resolve) => { resolveSnapshot = resolve })
  let snapshot: Reservation[] = []
  vi.spyOn(store, 'getReservations').mockImplementationOnce(async () => {
    snapshot = await originalRead()
    signalRead()
    return staleRead
  })
  const pendingList = poll()
  await readStarted
  let issuedToken: string | undefined
  let saved = ''
  try {
    const response = action === 'reissue' ? await issue(true) : await revoke()
    expect(response.status).toBe(200)
    if (action === 'reissue') issuedToken = (await response.json()).questionnaireToken
    saved = await fs.readFile(reservationsFile(), 'utf8')
  } finally {
    resolveSnapshot(snapshot)
  }
  expect((await pendingList).status).toBe(200)
  expect(await fs.readFile(reservationsFile(), 'utf8')).toBe(saved)
  await expectRejected(oldToken)
  if (issuedToken) expect((await read(issuedToken)).status).toBe(200)
})

it('serializes simultaneous issuance and revocation so polling cannot revive a superseded URL', async () => {
  const oldToken = await seedIssuedLegacyUrl()
  const responses = await Promise.all([issue(true), revoke(), issue(true), poll(), poll()])
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200])
  const [firstIssued, , lastIssued] = await Promise.all(responses.map((response) => response.json()))
  expect(firstIssued.questionnaireToken).not.toBe(lastIssued.questionnaireToken)
  const saved = (await store.getReservations())[0]
  await expectRejected(oldToken)
  for (const token of [firstIssued.questionnaireToken, lastIssued.questionnaireToken]) {
    if (token === saved.questionnaireToken) expect((await read(token)).status).toBe(200)
    else await expectRejected(token)
  }
  const before = await fs.readFile(reservationsFile(), 'utf8')
  expect((await poll()).status).toBe(200)
  expect(await fs.readFile(reservationsFile(), 'utf8')).toBe(before)
})

it('leaves saved answers, consent and the independent reception QR unchanged', async () => {
  await seedIssuedLegacyUrl()
  const file = path.join(directory, 'questionnaires.json')
  const answers = JSON.stringify([{
    id: 'M-1', reservationId, agreeRisk: true, agreeMedical: true,
    consentAt: '2026-10-06T01:00:00.000Z',
    qrToken: 'independent-reception-token', qrExpiresAt: expiry, qrUsed: false,
  }])
  await fs.writeFile(file, answers)
  expect((await issue(true)).status).toBe(200)
  expect((await revoke()).status).toBe(200)
  expect((await poll()).status).toBe(200)
  expect(await fs.readFile(file, 'utf8')).toBe(answers)
})
