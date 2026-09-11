const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute the real handlers with storage/I/O replaced; no customer data is touched.
function load(file, imports) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(js, {
    exports, process, console: { error() {} },
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name]
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  return exports
}

function api(reservations = [{ id: 'R-test' }]) {
  const writes = []
  const store = { getReservations: async () => reservations, getCustomers: async () => [] }
  for (const method of ['addQuestionnaire', 'updateReservation', 'addCustomer', 'updateCustomer']) {
    store[method] = async (...args) => writes.push({ method, args })
  }
  const { POST } = load('src/app/api/public/questionnaires/route.ts', {
    '@/lib/dataStore': { store },
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
  })
  return { POST, writes }
}
const valid = { reservationId: 'R-test', lastName: 'テスト', firstName: '太郎', agreeRisk: true, agreeMedical: true, agreePhoto: false }

test('rejects missing, false and non-boolean required consent without writing', async () => {
  for (const key of ['agreeRisk', 'agreeMedical']) {
    for (const value of [undefined, null, false, 'true', 1, {}]) {
      const { POST, writes } = api()
      assert.equal((await POST({ json: async () => ({ ...valid, [key]: value }) })).status, 400)
      assert.equal(writes.length, 0)
    }
  }
})
test('rejects unanswered or non-boolean photo permission without writing', async () => {
  for (const value of [undefined, null, 'false', 'true', 0, 1]) {
    const { POST, writes } = api()
    assert.equal((await POST({ json: async () => ({ ...valid, agreePhoto: value }) })).status, 400)
    assert.equal(writes.length, 0)
  }
})
test('accepts both photo choices and generates consent timestamp on server', async () => {
  for (const agreePhoto of [true, false]) {
    const { POST, writes } = api()
    const result = await POST({ json: async () => ({ ...valid, agreePhoto, id: 'forged', submittedAt: 'forged' }) })
    assert.equal(result.status, 200)
    const saved = writes.find(w => w.method === 'addQuestionnaire').args[0]
    assert.equal(saved.agreePhoto, agreePhoto)
    assert.equal(saved.agreeRisk, true)
    assert.equal(saved.agreeMedical, true)
    assert.notEqual(saved.id, 'forged')
    assert.ok(Number.isFinite(Date.parse(saved.submittedAt)))
    assert.equal(result.body.questionnaireId, saved.id)
  }
})
test('rejects invalid JSON and non-object payloads', async () => {
  for (const value of [null, [], 'text', 1]) {
    const { POST, writes } = api()
    assert.equal((await POST({ json: async () => value })).status, 400)
    assert.equal(writes.length, 0)
  }
  const { POST, writes } = api()
  assert.equal((await POST({ json: async () => { throw new SyntaxError() } })).status, 400)
  assert.equal(writes.length, 0)
})
test('unknown reservation is rejected without writes', async () => {
  const { POST, writes } = api([])
  assert.equal((await POST({ json: async () => valid })).status, 404)
  assert.equal(writes.length, 0)
})
test('corrupt or unreadable local records are never replaced by seed data', async () => {
  for (const mode of ['corrupt', 'EACCES']) {
    let writes = 0
    const store = load('src/lib/localStore.ts', {
      fs: { promises: {
        readFile: async () => {
          if (mode === 'corrupt') return '{broken'
          throw Object.assign(new Error('denied'), { code: mode })
        },
        mkdir: async () => {}, writeFile: async () => { writes++ },
      } },
      path, './mockData': { MOCK_QUESTIONNAIRES: [], MOCK_CUSTOMERS: [], MOCK_RESERVATIONS: [] },
    })
    await assert.rejects(() => store.getQuestionnaires())
    assert.equal(writes, 0)
  }
})
test('missing local file can still be initialized', async () => {
  let writes = 0
  const store = load('src/lib/localStore.ts', {
    fs: { promises: {
      readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
      mkdir: async () => {}, writeFile: async () => { writes++ },
    } },
    path, './mockData': { MOCK_QUESTIONNAIRES: [], MOCK_CUSTOMERS: [], MOCK_RESERVATIONS: [] },
  })
  assert.equal((await store.getQuestionnaires()).length, 0)
  assert.equal(writes, 1)
})
