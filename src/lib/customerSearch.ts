import type { Customer } from '@/types'

/**
 * 検索用の正規化。
 * NFKC で全角英数・半角カナを吸収し、カタカナはひらがなへ寄せ、大小文字と空白を無視する。
 * 「サトウ」「さとう」「ｻﾄｳ」、「佐藤 一郎」「佐藤一郎」がすべて同一視される。
 */
export const normalizeCustomerText = (v: string) =>
  v
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLocaleLowerCase('ja-JP')
    .replace(/\s/g, '')

/**
 * 電話番号は数字だけに揃える。
 * ハイフン位置の表記ゆれを吸収し、下4桁だけでの検索を成立させる
 * （実務ではハイフンの有無・位置が揃わず、完全一致だと該当0件になりやすいため）。
 */
const digitsOnly = (v: string) => v.normalize('NFKC').replace(/\D/g, '')

export function matchesCustomer(c: Customer, query: string): boolean {
  const q = normalizeCustomerText(query)
  if (!q) return true

  const matched = [
    c.id,
    c.lastName,
    c.firstName,
    `${c.lastName}${c.firstName}`,
    c.lastNameKana,
    c.firstNameKana,
    `${c.lastNameKana}${c.firstNameKana}`,
    c.phone,
    c.email,
  ].some((v) => normalizeCustomerText(v || '').includes(q))
  if (matched) return true

  // 数字を含む検索語だけ電話番号と突き合わせる
  const digits = digitsOnly(query)
  return !!digits && digitsOnly(c.phone || '').includes(digits)
}
