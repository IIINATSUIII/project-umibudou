import { createHash, timingSafeEqual } from 'node:crypto'

/** 推測されにくくするため、これより短いコードは「未設定」として扱う。 */
export const ADMIN_SETUP_CODE_MIN_LENGTH = 16

/**
 * 最初の管理者をアカウント作成画面から登録するための初期設定コード（環境変数 ADMIN_SETUP_CODE）。
 * 未設定・短すぎる場合は null を返し、画面からの管理者登録を無効にする。
 */
function configuredAdminSetupCode(): string | null {
  const code = process.env.ADMIN_SETUP_CODE?.trim() ?? ''
  return code.length >= ADMIN_SETUP_CODE_MIN_LENGTH ? code : null
}

export function isAdminSetupCodeConfigured(): boolean {
  return configuredAdminSetupCode() !== null
}

/** 入力されたコードが設定値と一致するか。比較時間で内容が漏れないようにハッシュ同士を比べる。 */
export function verifyAdminSetupCode(input: string): boolean {
  const expected = configuredAdminSetupCode()
  if (!expected || !input) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(input.trim()), digest(expected))
}
