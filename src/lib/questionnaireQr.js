const { randomBytes } = require('crypto')

/** @returns {string} 256bitの不透明なQRトークン */
function createQrToken() {
  return randomBytes(32).toString('hex')
}

/** @param {string} value */
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00+09:00`)
  return !Number.isNaN(date.getTime()) && date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) === value
}

/** @param {string} date */
function qrExpiryFor(date) {
  return new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000)
}

/** @param {string} expiresAt @param {number} [now] */
function isQrExpired(expiresAt, now = Date.now()) {
  const expiry = new Date(expiresAt).getTime()
  return !Number.isFinite(expiry) || expiry <= now
}

module.exports = { createQrToken, isValidDate, qrExpiryFor, isQrExpired }
