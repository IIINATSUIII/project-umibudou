/**
 * データ保存先の選択（サーバーサイド専用）
 * Google Sheets の認証情報が揃っていれば Sheets、無ければローカル JSON ストア。
 */

import * as sheets from './sheets'
import * as local from './localStore'

export const USE_SHEETS = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY &&
  process.env.GOOGLE_SPREADSHEET_ID
)

export const store = USE_SHEETS ? sheets : local
