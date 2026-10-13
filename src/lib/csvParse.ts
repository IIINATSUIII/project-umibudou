/**
 * RFC 4180 準拠のCSV解析（OTA予約CSV取込用、Issue #64）。
 * - 引用符で囲んだセル内のカンマ・改行・""（引用符のエスケープ）を扱う
 * - 改行は CRLF / LF / CR のいずれも可。先頭のBOMは除去する
 * - 引用符が閉じていない等の形式不正は CsvFormatError（MSG-14）
 * 文字コードの判定（UTF-8 / Shift_JIS）は呼び出し側（ブラウザ）で行い、ここには文字列を渡す。
 */

export class CsvFormatError extends Error {}

export type CsvRecord = {
  /** ファイル上の開始行番号（1始まり）。セル内改行があっても利用者が探せる番号 */
  line: number
  cells: string[]
}

export function parseCsv(text: string): CsvRecord[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let line = 1
  let recordLine = 1

  const endCell = () => {
    cells.push(cell)
    cell = ''
    afterQuote = false
  }
  const endRecord = () => {
    endCell()
    // 完全な空行は読み飛ばす（末尾の改行など）
    if (!(cells.length === 1 && cells[0] === '')) records.push({ line: recordLine, cells })
    cells = []
  }

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
          afterQuote = true
        }
      } else {
        if (ch === '\n' || (ch === '\r' && input[i + 1] !== '\n')) line += 1
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      if (cell !== '' || afterQuote) {
        throw new CsvFormatError(`${line}行目: 引用符（"）の位置が正しくありません`)
      }
      quoted = true
    } else if (ch === ',') {
      endCell()
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1
      endRecord()
      line += 1
      recordLine = line
    } else {
      if (afterQuote) {
        throw new CsvFormatError(`${line}行目: 引用符（"）の後に余分な文字があります`)
      }
      cell += ch
    }
  }

  if (quoted) throw new CsvFormatError(`${recordLine}行目: 引用符（"）が閉じられていません`)
  if (cell !== '' || cells.length > 0 || afterQuote) endRecord()
  return records
}
