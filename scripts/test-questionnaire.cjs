const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(source, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`)
    return dependencies[name]
  }, console, Date, Intl, process: { env: {} } })
  return exports
}
const validation = load('src/lib/questionnaireValidation.ts')
const valid = {
  lastName: '田中', firstName: '花子', lastNameKana: 'タナカ', firstNameKana: 'ハナコ',
  birthDate: '1995-06-15', gender: 'unanswered', postalCode: '900-0001', address: '沖縄県那覇市',
  phone: '090-1234-5678', email: 'test@example.com', emergencyName: '田中 太郎',
  emergencyRelation: '家族', emergencyPhone: '098-123-4567',
  ...Object.fromEntries(validation.HEALTH_FIELDS.map(([key]) => [key, false])),
  medication: false, medicationName: '', medicalCertificate: false,
  reservationId: 'R-test', agreeRisk: true, agreeMedical: true,
}

test('満年齢：誕生日前後・うるう日・未来日・不正日付', () => {
  assert.equal(validation.calculateAge('2000-09-08', '2026-09-07'), 25)
  assert.equal(validation.calculateAge('2000-09-08', '2026-09-08'), 26)
  assert.equal(validation.calculateAge('2000-02-29', '2025-02-28'), 24)
  assert.equal(validation.calculateAge('2000-02-29', '2025-03-01'), 25)
  for (const value of ['2025-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2027-01-01', 'invalid']) {
    assert.equal(validation.calculateAge(value, '2026-09-08'), null)
  }
})
test('未回答・形式エラー・服薬条件を検証し、なしは有効', () => {
  assert.equal(Object.keys(validation.validateQuestionnaire(valid)).length, 0)
  for (const field of validation.BASIC_FIELDS.filter((key) => key !== 'gender')) {
    assert.ok(validation.validateQuestionnaire({ ...valid, [field]: '  ' })[field], field)
  }
  for (const field of [...validation.HEALTH_FIELDS.map(([key]) => key), 'medication', 'medicalCertificate']) {
    for (const value of [null, undefined, 'false', 0]) assert.ok(validation.validateQuestionnaire({ ...valid, [field]: value })[field], field)
  }
  for (const [field, value] of [['email', 'a@'], ['phone', '０９０'], ['emergencyPhone', 'abc'], ['postalCode', '123'], ['lastNameKana', 'たなか'], ['birthDate', '2999-01-01']]) {
    assert.ok(validation.validateQuestionnaire({ ...valid, [field]: value })[field], field)
  }
  assert.ok(validation.validateQuestionnaire({ ...valid, medication: true }).medicationName)
  assert.equal(Object.keys(validation.validateQuestionnaire({ ...valid, medication: true, medicationName: '薬A' })).length, 0)
  for (const value of [null, [], 1, 'bad']) assert.ok(Object.keys(validation.validateQuestionnaire(value)).length)
})

function api() {
  const writes = []
  const store = {
    getReservations: async () => [{ id: 'R-test' }], getCustomers: async () => [],
    addQuestionnaire: async (data) => writes.push(['questionnaire', data]),
    updateReservation: async (...data) => writes.push(['reservation', ...data]),
    addCustomer: async (data) => writes.push(['customer', data]),
  }
  const route = load('src/app/api/public/questionnaires/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/dataStore': { store }, '@/lib/questionnaireValidation': validation,
  })
  return { writes, post: (body) => route.POST({ json: async () => body }) }
}
test('公開API：不正入力は保存前に400、未知の予約は404', async () => {
  for (const body of [null, { ...valid, email: '' }, { ...valid, hypertension: 'false' }, { ...valid, agreeMedical: false }]) {
    const { writes, post } = api()
    assert.equal((await post(body)).status, 400)
    assert.equal(writes.length, 0)
  }
  const { writes, post } = api()
  assert.equal((await post({ ...valid, reservationId: 'missing' })).status, 404)
  assert.equal(writes.length, 0)
})
test('公開API：追加項目・顧客メール・高血圧を保存', async () => {
  const { writes, post } = api()
  assert.equal((await post({ ...valid, hypertension: true, medicalCertificate: true, email: ' test@example.com ' })).status, 200)
  const q = writes.find(([kind]) => kind === 'questionnaire')[1]
  const customer = writes.find(([kind]) => kind === 'customer')[1]
  assert.equal(q.postalCode, valid.postalCode)
  assert.equal(q.hypertension, true)
  assert.equal(q.medicalCertificate, true)
  assert.equal(customer.email, 'test@example.com')
  assert.ok(customer.healthNotes.includes('高血圧'))
})

test('Sheets：旧37列を保持し、新規項目が往復・欠落booleanは未回答', async () => {
  let rows = []
  const sheets = load('src/lib/sheets.ts', {
    googleapis: { google: {
      auth: { GoogleAuth: class {} },
      sheets: () => ({ spreadsheets: { values: {
        append: async ({ requestBody }) => { rows.push(...requestBody.values) },
        get: async () => ({ data: { values: rows } }),
      } } }),
    } },
  })
  assert.equal(sheets.HEADERS.QUESTIONNAIRES[36], 'agreePhoto')
  assert.equal(sheets.HEADERS.QUESTIONNAIRES[37], 'postalCode')
  await sheets.addQuestionnaire({ ...valid, id: 'Q-test', hypertension: true })
  let [q] = await sheets.getQuestionnaires()
  assert.equal(q.postalCode, valid.postalCode)
  assert.equal(q.email, valid.email)
  assert.equal(q.hypertension, true)
  assert.equal(q.medicalCertificate, false)
  rows = rows.map((row) => row.slice(0, 37))
  ;[q] = await sheets.getQuestionnaires()
  assert.equal(q.id, 'Q-test')
  assert.equal(q.hypertension, undefined)
  assert.equal(q.medicalCertificate, undefined)
})
