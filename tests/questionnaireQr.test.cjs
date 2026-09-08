const test = require('node:test')
const assert = require('node:assert/strict')
const { createQrToken, isValidDate, qrExpiryFor, isQrExpired } = require('../src/lib/questionnaireQr.js')

test('QRトークンは256bitの不透明なhex値を生成する', () => {
  const first = createQrToken()
  const second = createQrToken()

  assert.match(first, /^[0-9a-f]{64}$/)
  assert.match(second, /^[0-9a-f]{64}$/)
  assert.notEqual(first, second)
})

test('予約日は実在する暦日だけを受け付ける', () => {
  assert.equal(isValidDate('2026-09-08'), true)
  assert.equal(isValidDate('2026-02-31'), false)
  assert.equal(isValidDate('9999-99-99'), false)
  assert.equal(isValidDate('2026/09/08'), false)
})

test('QRの有効期限は対象ダイブ日の翌日0時（日本時間）になる', () => {
  assert.equal(qrExpiryFor('2026-09-08').toISOString(), '2026-09-08T15:00:00.000Z')
})

test('QRは期限時刻ちょうどで期限切れになる', () => {
  const expiresAt = '2026-09-09T00:00:00+09:00'
  const expiry = new Date(expiresAt).getTime()

  assert.equal(isQrExpired(expiresAt, expiry - 1), false)
  assert.equal(isQrExpired(expiresAt, expiry), true)
  assert.equal(isQrExpired('invalid-date', expiry), true)
})
