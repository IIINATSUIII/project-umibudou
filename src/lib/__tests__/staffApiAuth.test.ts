import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { createSessionToken, SESSION_COOKIE } from '../session'

const dependencies = vi.hoisted(() => ({
  store: {
    getCustomers: vi.fn(), searchCustomers: vi.fn(), addCustomer: vi.fn(), updateCustomer: vi.fn(),
    getReservations: vi.fn(), updateReservation: vi.fn(), addReservation: vi.fn(),
    getQuestionnaires: vi.fn(), searchQuestionnaires: vi.fn(), getQuestionnaireById: vi.fn(),
    addQuestionnaire: vi.fn(), updateQuestionnaire: vi.fn(), getRoster: vi.fn(), addRoster: vi.fn(),
  },
  lock: vi.fn(), initializeSheets: vi.fn(), importBookings: vi.fn(),
}))
vi.mock('@/lib/dataStore', () => ({
  store: dependencies.store, USE_POSTGRES: false, DataStoreError: class extends Error {},
}))
vi.mock('@/lib/storeLock', () => ({
  withStoreWriteLock: dependencies.lock, StoreBusyError: class extends Error {},
}))
vi.mock('@/lib/sheets', () => ({ initializeSheets: dependencies.initializeSheets }))
vi.mock('@/lib/googleFormImport', () => ({ importGoogleFormBookings: dependencies.importBookings }))
vi.mock('@/lib/listReads', () => ({
  getReservationsForList: () => dependencies.store.getReservations(),
  getQuestionnairesForList: () => dependencies.store.getQuestionnaires(),
}))


import * as customers from '@/app/api/customers/route'
import * as roster from '@/app/api/roster/route'
import * as setup from '@/app/api/setup/route'
import * as urls from '@/app/api/reservations/questionnaire-url/route'
import * as reservations from '@/app/api/reservations/route'
import * as questionnaires from '@/app/api/questionnaires/route'
import * as checkin from '@/app/api/questionnaires/checkin/route'

const secret = 'staff-api-test-secret-never-use-in-production'
const actions = [
  { path: '/api/customers', method: 'GET', handler: customers.GET, status: 200 },
  { path: '/api/customers', method: 'POST', handler: customers.POST, body: {}, status: 200 },
  { path: '/api/customers', method: 'PATCH', handler: customers.PATCH, body: { id: 'missing' }, status: 404 },
  { path: '/api/roster', method: 'GET', handler: roster.GET, status: 200 },
  { path: '/api/roster', method: 'POST', handler: roster.POST, body: { questionnaireId: 'missing', method: '手動照合' }, status: 404 },
  { path: '/api/setup', method: 'POST', handler: setup.POST, body: {}, status: 200 },
  { path: '/api/reservations/questionnaire-url', method: 'POST', handler: urls.POST, body: { id: 'R-test' }, status: 200 },
  { path: '/api/reservations/questionnaire-url', method: 'DELETE', handler: urls.DELETE, body: { id: 'R-test' }, status: 200 },
  { path: '/api/reservations', method: 'GET', handler: reservations.GET, status: 200 },
  { path: '/api/reservations', method: 'POST', handler: reservations.POST, body: {}, status: 400 },
  { path: '/api/reservations', method: 'PATCH', handler: reservations.PATCH, body: {}, status: 400 },
  { path: '/api/questionnaires', method: 'GET', handler: questionnaires.GET, status: 200 },
  { path: '/api/questionnaires', method: 'POST', handler: questionnaires.POST, body: null, status: 400 },
  { path: '/api/questionnaires', method: 'PATCH', handler: questionnaires.PATCH, body: {}, status: 400 },
  { path: '/api/questionnaires/checkin', method: 'GET', handler: checkin.GET, status: 400 }, { path: '/api/questionnaires/checkin', method: 'POST', handler: checkin.POST, body: {}, status: 400 },
] as const

const allBusinessCalls = () => [
  ...Object.values(dependencies.store), dependencies.lock, dependencies.initializeSheets, dependencies.importBookings,
]

function request(action: typeof actions[number], token?: string, malformed = false, bypass = false) {
  return new NextRequest(`http://localhost${action.path}`, {
    method: action.method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(bypass ? { 'x-middleware-subrequest': Array(5).fill('src/middleware').join(':') } : {}),
    },
    ...(action.method === 'GET' ? {} : {
      body: malformed ? '{' : JSON.stringify('body' in action ? action.body : {}),
    }),
  })
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', secret)
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('ENABLE_SHEETS_SETUP', 'true')
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  for (const spy of Object.values(dependencies.store)) spy.mockResolvedValue([])
  dependencies.store.getReservations.mockResolvedValue([{
    id: 'R-test', diveDate: '2099-01-02', status: 'STS-03',
    questionnaireToken: 'test-reservation-token-with-at-least-128-bits',
    questionnaireTokenExpiresAt: '2099-01-02T15:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z',
  }])
  dependencies.lock.mockImplementation(async (work: () => Promise<unknown>) => work())
  dependencies.initializeSheets.mockResolvedValue({ migrated: true })
  dependencies.importBookings.mockResolvedValue({ errors: [] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe.each(actions)('$method $path independently authenticates staff', (action) => {
  it.each(['missing cookie', 'invalid cookie', 'middleware bypass header', 'malformed JSON'])(
    'rejects %s before parsing input or accessing data', async (scenario) => {
      const req = request(action, scenario === 'invalid cookie' ? 'invalid.jwt' : undefined,
        scenario === 'malformed JSON', scenario === 'middleware bypass header')
      const parse = vi.spyOn(req, 'json')
      const response = await action.handler(req)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(parse).not.toHaveBeenCalled()
      for (const spy of allBusinessCalls()) expect(spy).not.toHaveBeenCalled()
    },
  )

  it('keeps the existing successful or validation response for an actual signed session', async () => {
    const response = await action.handler(request(action, await createSessionToken('staff@example.com')))
    expect(response.status).toBe(action.status)
    if (action.method === 'GET') expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses to process data when the signing key is missing', async () => {
    vi.stubEnv('SESSION_SECRET', '')
    const response = await action.handler(request(action))
    expect(response.status).toBe(503)
    for (const spy of allBusinessCalls()) expect(spy).not.toHaveBeenCalled()
  })

  it('rejects a correctly signed legacy token with an empty email', async () => {
    const token = await new SignJWT({ email: '' }).setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h').sign(new TextEncoder().encode(secret))
    const response = await action.handler(request(action, token))
    expect(response.status).toBe(401)
    for (const spy of allBusinessCalls()) expect(spy).not.toHaveBeenCalled()
  })
})

describe('setup is limited to explicitly enabled development maintenance', () => {
  it.each([
    { environment: 'production', enabled: 'true' },
    { environment: 'production', enabled: '' },
    { environment: 'development', enabled: '' },
    { environment: 'development', enabled: 'false' },
    { environment: 'test', enabled: 'true' },
  ])('is disabled for $environment / $enabled', async ({ environment, enabled }) => {
    vi.stubEnv('NODE_ENV', environment)
    vi.stubEnv('ENABLE_SHEETS_SETUP', enabled)
    const action = actions.find(item => item.path === '/api/setup')!
    const response = await setup.POST(request(action, await createSessionToken('staff@example.com')))
    expect(response.status).toBe(404)
    expect(dependencies.initializeSheets).not.toHaveBeenCalled()
  })

  it('does not expose an initialization error to the client or logs', async () => {
    dependencies.initializeSheets.mockRejectedValue(new Error('private-google-key'))
    const action = actions.find(item => item.path === '/api/setup')!
    const response = await setup.POST(request(action, await createSessionToken('staff@example.com')))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private-google-key')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-google-key')
  })
})

it('classifies every exported API operation so a newly added route cannot silently skip review', () => {
  const root = path.resolve(__dirname, '../../app/api')
  const exported: string[] = []
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/^route\.(ts|js)$/.test(entry.name)) {
        const url = '/api/' + path.relative(root, directory).split(path.sep).join('/')
        const source = readFileSync(file, 'utf8')
        const methods = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS'])
        const addMethod = (name: string) => { if (methods.has(name)) exported.push(`${name} ${url}`) }
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
        for (const statement of ast.statements) {
          if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            statement.exportClause.elements.forEach(element => addMethod(element.name.text))
          } else if (ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement)) {
            if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
            if (ts.isFunctionDeclaration(statement)) { if (statement.name) addMethod(statement.name.text) }
            else statement.declarationList.declarations.forEach(declaration => {
              if (ts.isIdentifier(declaration.name)) addMethod(declaration.name.text)
            })
          }
        }
      }
    }
  }
  visit(root)
  const nonStaff = [
    'GET /api/auth', 'POST /api/auth', 'DELETE /api/auth',
    'POST /api/public/bookings', 'GET /api/public/questionnaires', 'POST /api/public/questionnaires',
    'POST /api/public/checkin-qr', 'GET /api/cron/sheets-outbox', 'POST /api/cron/sheets-outbox',
  ]
  expect(exported.sort()).toEqual([...actions.map(action => `${action.method} ${action.path}`), ...nonStaff].sort())
})
