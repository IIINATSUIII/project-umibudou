/** Production HTTP regression with isolated dummy credentials and disposable JSON data. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SignJWT } from 'jose'

const root = process.cwd()
await readFile(path.join(root, '.next/BUILD_ID'), 'utf8')
const data = await mkdtemp(path.join(tmpdir(), 'umibudou-auth-smoke-'))
const files = ['customers', 'reservations', 'reservation-emails', 'questionnaires', 'roster']
for (const name of files) await writeFile(path.join(data, `${name}.json`), '[]\n')
const snapshot = async () => Promise.all(files.map(name => readFile(path.join(data, `${name}.json`), 'utf8')))
const listener = net.createServer()
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
const base = `http://127.0.0.1:${port}`
const secret = 'http-smoke-only-session-secret-never-use-in-production'
const email = 'http-smoke@example.com'
const password = 'http-smoke-only-password'
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: root, windowsHide: true,
  env: {
    ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    SESSION_SECRET: secret, STAFF_CREDENTIALS: `${email}:${password}`,
    DATA_STORE: 'json', LOCAL_DATA_DIR: data, ENABLE_SHEETS_SETUP: 'true',
    CRON_SECRET: 'http-smoke-only-cron-secret', DATABASE_URL: '',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '', GOOGLE_SPREADSHEET_ID: '',
    GOOGLE_FORM_RESPONSES_SHEET: '', GOOGLE_FORM_SPREADSHEET_ID: '', GOOGLE_DATASTORE_LOCK_PROJECT_ID: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let diagnostics = ''
let requests = 0
server.stdout.on('data', value => { diagnostics = (diagnostics + value).slice(-6000) })
server.stderr.on('data', value => { diagnostics = (diagnostics + value).slice(-6000) })
const exited = new Promise(resolve => server.once('exit', resolve))
let cookie

async function call(method, url, options = {}) {
  requests++
  const response = await fetch(base + url, {
    method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...('body' in options ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...('body' in options ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  const body = response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) : text
  if (options.status !== undefined) assert.equal(response.status, options.status, `${method} ${url}: ${JSON.stringify(body).slice(0, 200)}`)
  return { response, body }
}

try {
  const deadline = Date.now() + 45000
  for (;;) {
    if (server.exitCode !== null) throw new Error(`Server exited before readiness: ${diagnostics}`)
    try { if ((await fetch(base + '/api/auth', { signal: AbortSignal.timeout(1000) })).ok) break } catch { /* server is starting */ }
    assert(Date.now() < deadline, `Server did not become ready: ${diagnostics}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  const staff = [
    ['GET', '/api/customers'], ['POST', '/api/customers'], ['PATCH', '/api/customers'],
    ['GET', '/api/reservations'], ['POST', '/api/reservations'], ['PATCH', '/api/reservations'],
    ['GET', '/api/questionnaires'], ['POST', '/api/questionnaires'], ['PATCH', '/api/questionnaires'],
    ['POST', '/api/questionnaires/checkin'], ['GET', '/api/roster'], ['POST', '/api/roster'],
    ['POST', '/api/reservations/questionnaire-url'], ['DELETE', '/api/reservations/questionnaire-url'],
    ['POST', '/api/reservations/email-retry'], ['POST', '/api/setup'],
  ]
  const key = new TextEncoder().encode(secret)
  const emptyIdentity = await new SignJWT({ email: '' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
  const expired = await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(1).sign(key)
  const before = await snapshot()
  for (const [method, url] of staff) {
    const scenarios = [
      {}, { cookie: 'odp_session=invalid.jwt' }, { cookie: `odp_session=${emptyIdentity}` }, { cookie: `odp_session=${expired}` },
      { headers: { 'x-middleware-subrequest': Array(5).fill('src/middleware').join(':') } },
      { headers: { 'x-middleware-subrequest': Array(5).fill('src/proxy').join(':') } },
    ]
    for (const scenario of scenarios) {
      const { response, body } = await call(method, url, { ...scenario, ...(method === 'GET' ? {} : { body: '{' }), status: 401 })
      assert.deepEqual(body, { error: 'Unauthorized' })
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('location'), null)
    }
  }
  assert.deepEqual(await snapshot(), before, 'Unauthorized requests changed stored data')
  for (const url of ['/api/customers', '/api/reservations', '/api/questionnaires', '/api/roster']) await call('HEAD', url, { status: 401 })
  for (const url of ['/dashboard', '/questionnaire/scan']) await call('GET', url, { status: 307 })
  for (const url of ['/login', '/booking', '/line-menu/checkin']) await call('GET', url, { status: 200 })
  await call('GET', '/line-rich-menu.png', { status: 200 })
  await call('POST', '/api/auth', { body: '{', status: 400 })
  await call('POST', '/api/auth', { body: { email, password: 'wrong-password' }, status: 401 })
  const loggedIn = await call('POST', '/api/auth', { body: { email, password }, status: 200 })
  const setCookie = loggedIn.response.headers.get('set-cookie')
  assert(setCookie?.includes('HttpOnly') && setCookie.includes('Secure') && setCookie.includes('SameSite=lax'))
  cookie = setCookie.split(';')[0]
  assert.deepEqual((await call('GET', '/api/auth', { cookie, status: 200 })).body, { user: { email, role: 'staff' } })
  assert.equal((await call('GET', '/api/customers', { cookie, status: 200 })).response.headers.get('cache-control'), 'no-store')
  await call('GET', '/api/customers', { status: 401 })
  await call('GET', '/api/customers', { cookie, status: 200 })
  await call('POST', '/api/setup', { cookie, body: {}, status: 404 })
  await call('PUT', '/api/customers', { cookie, body: {}, status: 405 })
  await call('OPTIONS', '/api/customers', { cookie, status: 204 })
  assert.deepEqual(await snapshot(), before, 'Disabled setup or unsupported operations changed stored data')

  const booking = (await call('POST', '/api/public/bookings', {
    headers: { 'Idempotency-Key': 'http-smoke-booking-1' },
    body: { guestName: '検証 太郎', guestPhone: '090-0000-0000', guestEmail: 'guest@example.com',
      diveDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }), timeSlot: 'morning', courseId: 'CRS-001', guestCount: 1 }, status: 200,
  })).body
  const list = (await call('GET', '/api/reservations', { cookie, status: 200 })).body
  const reservation = list.find(item => item.id === booking.id)
  assert(reservation)
  await call('PATCH', '/api/reservations', {
    cookie, body: { id: booking.id, expectedUpdatedAt: reservation.updatedAt, status: 'STS-03' }, status: 200,
  })
  const issued = (await call('POST', '/api/reservations/questionnaire-url', { cookie, body: { id: booking.id }, status: 200 })).body
  const accessToken = issued.questionnaireToken
  await call('GET', `/questionnaire/${encodeURIComponent(accessToken)}`, { status: 200 })
  assert.deepEqual((await call('GET', `/api/public/questionnaires?accessToken=${encodeURIComponent(accessToken)}`, { status: 200 })).body, { submitted: false })
  const form = {
    accessToken, submissionId: randomUUID(), lastName: '検証', firstName: '太郎', lastNameKana: 'ケンショウ', firstNameKana: 'タロウ',
    birthDate: '1990-01-01', gender: 'unanswered', postalCode: '900-0001', address: '沖縄県 テスト住所',
    phone: '090-0000-0000', email: 'guest@example.com', emergencyName: '検証 花子', emergencyRelation: '家族', emergencyPhone: '090-0000-0001',
    heartDisease: false, hypertension: false, respiratoryDisease: false, earDisease: false, epilepsy: false, diabetes: false,
    pregnant: false, panicDisorder: false, medication: false, medicationName: '', medicalCertificate: false, latexAllergy: false,
    sleepCategory: '6時間以上', alcoholLastNight: false, alcoholToday: false, condition: 'good', conditionDetails: '', flightWithin48h: false,
    hasCCard: false, cCardType: '未取得', cCardOrg: '', lastDivePeriod: '初めて', totalDives: null,
    agreeRisk: true, agreeMedical: true, agreePhoto: false,
  }
  const submission = (await call('POST', '/api/public/questionnaires', { body: form, status: 200 })).body
  assert(submission.questionnaireId && submission.qrToken)
  assert.equal((await call('POST', '/api/public/questionnaires', { body: form, status: 200 })).body.questionnaireId, submission.questionnaireId)
  const restored = (await call('POST', '/api/public/checkin-qr', {
    body: { reservationId: booking.id, reservationToken: accessToken }, status: 200,
  })).body
  assert.equal(restored.participants[0].token, submission.qrToken)
  assert.equal('heartDisease' in restored.participants[0], false)
  await call('GET', `/api/questionnaires?id=${encodeURIComponent(submission.questionnaireId)}`, { cookie, status: 200 })
  await call('POST', '/api/questionnaires/checkin', { cookie, body: { token: submission.qrToken }, status: 200 })
  await call('POST', '/api/roster', { cookie, body: { questionnaireId: submission.questionnaireId, method: '手動照合' }, status: 200 })
  assert.equal((await call('GET', '/api/roster', { cookie, status: 200 })).body.length, 1)
  await call('DELETE', '/api/reservations/questionnaire-url', { cookie, body: { id: booking.id }, status: 200 })
  await call('GET', `/api/public/questionnaires?accessToken=${encodeURIComponent(accessToken)}`, { status: 404 })
  await call('POST', '/api/cron/sheets-outbox', { cookie, status: 401 })
  await call('POST', '/api/cron/sheets-outbox', { headers: { authorization: 'Bearer wrong-secret' }, status: 401 })
  await call('GET', '/api/cron/sheets-outbox', { headers: { authorization: 'Bearer http-smoke-only-cron-secret' }, status: 503 })
  await call('DELETE', '/api/auth', { cookie, status: 200 })
  await call('GET', '/api/customers', { status: 401 })
  console.log(`HTTP security smoke passed: ${requests} requests; ${staff.length} staff operations; guest booking/questionnaire/QR/checkin/roster/logout.`)
  if (process.argv.includes('--keep-server')) {
    console.log(`Browser fixture: ${base}/login ; email ${email} ; password ${password}`)
    console.log('Press Enter to stop the fixture server and remove its dummy data.')
    process.stdin.resume()
    await new Promise(resolve => process.stdin.once('data', resolve))
    process.stdin.pause()
  }
} catch (error) {
  console.error(diagnostics)
  throw error
} finally {
  server.kill()
  await exited
  // Remove only regular files in the fresh directory owned by this run; never recurse.
  assert.equal(path.dirname(data), path.resolve(tmpdir()))
  for (const entry of await readdir(data, { withFileTypes: true })) {
    if (entry.isFile()) await unlink(path.join(data, entry.name))
  }
  await rmdir(data)
}
