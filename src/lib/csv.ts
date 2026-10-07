/**
 * CSVインジェクション対策付きのセル出力。
 * 利用者が入力した値（住所・氏名など）が「=」「+」「-」「@」やタブ・改行で始まっていると、
 * 表計算ソフトが数式として評価してしまう。引用符で囲んでも無効化されないため、
 * 先頭に ' を付けて文字列セルとして扱わせる（OWASP の推奨する無害化）。
 */
const FORMULA_START = /^[=+\-@\t\r\n]/

export function toSafeCsvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
