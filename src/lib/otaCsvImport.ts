/**
 * OTA（じゃらん・アソビュー等）予約CSVの取込（Issue #64、詳細設計書「予約CSVインポート」）。
 * - 見出し名で列を対応させる（OTAごとに列順が違うため）。必須列が無いファイルは MSG-14
 * - 行ごとに形式チェックし、不正な行は取り込まず理由を返す。既存データは変更しない（追記のみ）
 * - 予約IDは予約番号（無ければ行の内容）から決まるため、同じファイルを再取込しても重複しない
 * サーバーサイド専用。API Route からのみ呼び出すこと。
 */

import { createHash } from 'crypto'
import { store } from './dataStore'
import { invalidateReadCache } from './readCache'
import { withStoreWriteLock } from './storeLock'
import { COURSES, CONFIRMED_STATUS_ID, getCourseName } from './masters'
import { validateNewReservationInput } from './reservationValidation'
import { getQuestionnaireExpiry, generateQuestionnaireToken } from './questionnaireToken'
import { normalizeHeader, parseDate, parseTime } from './googleFormImport'
import { CsvFormatError, parseCsv } from './csvParse'
import type { Reservation, ReservationTimeSlot } from '@/types'

export { CsvFormatError } from './csvParse'

/** 1回の取込で扱う上限（API呼出し・画面表示の上限を兼ねる） */
export const OTA_CSV_MAX_ROWS = 1000
export const OTA_CSV_MAX_CHARS = 2_000_000

type Field = 'bookingNo' | 'date' | 'time' | 'course' | 'guestName' | 'guestPhone' | 'guestEmail' | 'guestCount' | 'notes'

const HEADER_ALIASES: Record<Field, string[]> = {
  bookingNo: ['予約番号', '予約ID', '予約No', '予約NO', '予約no', '受付番号', '申込番号', '予約コード'],
  date: ['利用日', 'ご利用日', '体験日', '参加日', '開催日', '実施日', '予約日', '希望日', '日付', '利用日時', '体験日時', '参加日時', '開催日時'],
  time: ['開始時間', '開始時刻', '集合時間', '集合時刻', '利用時間', '時間帯', '時間'],
  course: ['プラン名', 'プラン', 'コース名', 'コース', '商品名', 'メニュー', '体験名'],
  guestName: ['代表者氏名', '代表者名', '予約者氏名', '予約者名', 'お名前', '氏名', '名前'],
  guestPhone: ['電話番号', '代表者電話番号', '予約者電話番号', '連絡先電話番号', '携帯電話番号', '連絡先', '電話'],
  guestEmail: ['メールアドレス', '代表者メールアドレス', '予約者メールアドレス', 'Eメール', 'Eメールアドレス', 'email', 'メール'],
  guestCount: ['人数', '参加人数', '利用人数', '予約人数', '合計人数', '参加者数'],
  notes: ['備考', '要望', 'ご要望', '質問', '連絡事項', 'メモ'],
}
const REQUIRED: { field: Field; label: string }[] = [
  { field: 'date', label: '利用日' },
  { field: 'course', label: 'プラン名／コース' },
  { field: 'guestName', label: '代表者氏名' },
  { field: 'guestPhone', label: '電話番号' },
  { field: 'guestEmail', label: 'メールアドレス' },
  { field: 'guestCount', label: '人数' },
]

export type OtaRowResult = {
  /** CSV上の行番号（見出しが1行目） */
  line: number
  status: 'ready' | 'imported' | 'duplicate' | 'invalid'
  guestName?: string
  diveDate?: string
  courseName?: string
  reservationId?: string
  messages: string[]
}

export type OtaImportResult = {
  dryRun: boolean
  imported: number
  ready: number
  duplicates: number
  invalid: number
  rows: OtaRowResult[]
}

function findColumns(headers: string[]): Record<Field, number> {
  const normalized = headers.map(normalizeHeader)
  return Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as Field[]).map((field) => {
      // 別名の並び順を優先度とする（例：「電話番号」を「連絡先」より優先）
      for (const alias of HEADER_ALIASES[field]) {
        const index = normalized.indexOf(normalizeHeader(alias))
        if (index >= 0) return [field, index]
      }
      return [field, -1]
    })
  ) as Record<Field, number>
}

/** 「2名」「大人2名 子供1名」→ 合計人数。数字だけのセルも可 */
export function parseGuestCount(value: string): number | null {
  const text = value.normalize('NFKC').trim()
  if (/^\d+$/.test(text)) return Number(text)
  const counts = text.match(/\d+(?=\s*[名人])/g)
  if (!counts) return null
  return counts.reduce((sum, count) => sum + Number(count), 0)
}

/** 「午前」「13:00」「終日」等 → 時間帯。読めなければ「指定なし」 */
export function parseTimeSlot(value: string): { timeSlot: ReservationTimeSlot; time?: string } {
  const text = value.normalize('NFKC').trim()
  if (!text) return { timeSlot: 'unspecified' }
  if (/終日|1日|一日/.test(text)) return { timeSlot: 'full' }
  const time = parseTime(text) ?? undefined
  if (time) return { timeSlot: Number(time.slice(0, 2)) < 12 ? 'morning' : 'afternoon', time }
  if (/午前|AM/i.test(text)) return { timeSlot: 'morning' }
  if (/午後|PM/i.test(text)) return { timeSlot: 'afternoon' }
  return { timeSlot: 'unspecified' }
}

/**
 * OTAのプラン名をコースマスタへ対応させる。
 * コースID・コース名の完全一致 → プラン名に含まれるコース名（長い名前を優先）の順。
 */
export function resolveCourseId(planName: string): string | undefined {
  const text = planName.normalize('NFKC').trim()
  const exact = COURSES.find((course) => course.id === text || course.name.normalize('NFKC') === text)
  if (exact) return exact.id
  const compact = text.replace(/\s/g, '')
  return [...COURSES]
    .sort((a, b) => b.name.length - a.name.length)
    .find((course) => compact.includes(course.name.normalize('NFKC').replace(/\s/g, '')))?.id
}

function reservationIdFor(key: string): string {
  return `R-OTA-${createHash('sha256').update(key).digest('hex').slice(0, 20).toUpperCase()}`
}

function cell(row: string[], index: number): string {
  return index >= 0 ? String(row[index] ?? '').trim() : ''
}

/** CSVを解析・検証する。ファイル全体が不正なら CsvFormatError */
export function prepareOtaReservations(csvText: string): { rows: OtaRowResult[]; reservations: Map<number, Reservation> } {
  if (csvText.length > OTA_CSV_MAX_CHARS) throw new CsvFormatError('ファイルが大きすぎます（2MBまで）')
  const records = parseCsv(csvText)
  if (records.length === 0) throw new CsvFormatError('見出し行がありません')
  const [header, ...data] = records
  if (data.length === 0) throw new CsvFormatError('予約の行がありません')
  if (data.length > OTA_CSV_MAX_ROWS) throw new CsvFormatError(`1回に取り込めるのは${OTA_CSV_MAX_ROWS}行までです`)

  const columns = findColumns(header.cells)
  const missing = REQUIRED.filter(({ field }) => columns[field] < 0).map(({ label }) => label)
  if (missing.length > 0) throw new CsvFormatError(`必要な列がありません: ${missing.join('、')}`)

  const rows: OtaRowResult[] = []
  const reservations = new Map<number, Reservation>()
  const seenInFile = new Map<string, number>()
  const now = new Date().toISOString()

  for (const record of data) {
    const row = record.cells
    if (row.every((value) => value.trim() === '')) continue
    const messages: string[] = []
    // 末尾の余分な空セル（行末のカンマ）は許容する
    const extraFilled = row.slice(header.cells.length).some((value) => value.trim() !== '')
    if (row.length < header.cells.length || extraFilled) {
      messages.push(`列の数が見出しと一致しません（見出し${header.cells.length}列／この行${row.length}列）`)
    }

    const bookingNo = cell(row, columns.bookingNo).normalize('NFKC')
    const planName = cell(row, columns.course)
    const diveDate = parseDate(cell(row, columns.date).normalize('NFKC'))
    const { timeSlot, time } = parseTimeSlot(columns.time >= 0 ? cell(row, columns.time) : cell(row, columns.date))
    const guestCount = parseGuestCount(cell(row, columns.guestCount))
    const courseId = resolveCourseId(planName)
    const guestPhone = cell(row, columns.guestPhone).normalize('NFKC').replace(/\s/g, '')
    const notes = cell(row, columns.notes)

    if (!diveDate) messages.push('利用日を日付として読み取れません')
    if (!planName) messages.push('プラン名を入力してください')
    else if (!courseId) messages.push(`プラン「${planName.slice(0, 40)}」に対応するコースがありません`)

    const staffNote = `[OTA-CSV] ${[
      bookingNo && `予約番号: ${bookingNo}`,
      planName && courseId && getCourseName(courseId) !== planName && `プラン: ${planName}`,
      notes && `備考: ${notes}`,
    ].filter(Boolean).join(' / ')}`.trim().slice(0, 500)

    const validation = validateNewReservationInput({
      guestName: cell(row, columns.guestName),
      guestPhone,
      guestEmail: cell(row, columns.guestEmail).normalize('NFKC'),
      diveDate: diveDate ?? '',
      timeSlot,
      courseId: courseId ?? '',
      guestCount: guestCount ?? Number.NaN,
      channel: 'ota',
      status: CONFIRMED_STATUS_ID,
      staffNote,
    }, { allowOta: true })
    if (!validation.ok) {
      // 日付・コースは上で具体的な理由を出しているので重複させない
      const skip = new Set(['diveDate', 'courseId', 'channel'])
      for (const [field, message] of Object.entries(validation.fields)) {
        if (!skip.has(field) && message) messages.push(message)
      }
    }

    const summary = {
      line: record.line,
      guestName: cell(row, columns.guestName).slice(0, 50) || undefined,
      diveDate: diveDate ?? undefined,
      courseName: courseId ? getCourseName(courseId) : planName.slice(0, 40) || undefined,
    }
    if (messages.length > 0 || !validation.ok) {
      rows.push({ ...summary, status: 'invalid', messages })
      continue
    }

    const data = validation.data
    const key = bookingNo
      ? `ota-booking:${bookingNo}`
      : `ota-row:${data.diveDate}|${data.guestName}|${data.guestPhone}|${data.courseId}|${data.guestCount}|${time ?? data.timeSlot}`
    const id = reservationIdFor(key)
    const firstLine = seenInFile.get(id)
    if (firstLine !== undefined) {
      rows.push({ ...summary, status: 'duplicate', reservationId: id, messages: [`${firstLine}行目と同じ予約です`] })
      continue
    }
    seenInFile.set(id, record.line)

    reservations.set(record.line, {
      id,
      createdAt: now,
      updatedAt: now,
      guestName: data.guestName,
      guestPhone: data.guestPhone,
      guestEmail: data.guestEmail,
      diveDate: data.diveDate,
      timeSlot: data.timeSlot,
      ...(time ? { time, legacyTime: time } : {}),
      courseId: data.courseId,
      courseName: getCourseName(data.courseId),
      guestCount: data.guestCount,
      status: data.status ?? CONFIRMED_STATUS_ID,
      channel: 'ota',
      questionnaireCompleted: false,
      questionnaireToken: generateQuestionnaireToken(),
      questionnaireTokenExpiresAt: getQuestionnaireExpiry(data.diveDate),
      staffNote: data.staffNote,
    })
    rows.push({ ...summary, status: 'ready', reservationId: id, messages: [] })
  }

  return { rows, reservations }
}

function summarize(dryRun: boolean, rows: OtaRowResult[]): OtaImportResult {
  const count = (status: OtaRowResult['status']) => rows.filter((row) => row.status === status).length
  return {
    dryRun,
    imported: count('imported'),
    ready: count('ready'),
    duplicates: count('duplicate'),
    invalid: count('invalid'),
    rows,
  }
}

/**
 * CSVを取り込む。dryRun=true は保存せず、取込予定・重複・不正の行を返す（画面の確認用）。
 * 既存予約との重複は書込ロック内で確認し、正常な行だけをまとめて追記する。
 */
export async function importOtaCsv(csvText: string, { dryRun = false } = {}): Promise<OtaImportResult> {
  const { rows, reservations } = prepareOtaReservations(csvText)

  const markExisting = (existingIds: Set<string>) => {
    for (const row of rows) {
      if (row.status === 'ready' && row.reservationId && existingIds.has(row.reservationId)) {
        row.status = 'duplicate'
        row.messages = ['取込済みの予約です']
        reservations.delete(row.line)
      }
    }
  }

  if (dryRun || reservations.size === 0) {
    if (reservations.size > 0) markExisting(new Set((await store.getReservations()).map((r) => r.id)))
    return summarize(true, rows)
  }

  await withStoreWriteLock(async () => {
    markExisting(new Set((await store.getReservations()).map((r) => r.id)))
    const pending = rows.filter((row) => row.status === 'ready')
    if (pending.length === 0) return
    if (store.addReservations) {
      // 一括追記は全件成功か全件失敗のどちらか
      await store.addReservations(pending.map((row) => reservations.get(row.line) as Reservation))
      for (const row of pending) row.status = 'imported'
      invalidateReadCache()
      invalidateReadCache()
      return
    }
    for (const row of pending) {
      try {
        await store.addReservation(reservations.get(row.line) as Reservation); invalidateReadCache()
        row.status = 'imported'
      } catch (err) {
        console.error(`[otaCsvImport] ${row.line}行目の保存に失敗しました`, err)
        row.status = 'invalid'
        row.messages = ['保存に失敗しました。時間をおいて再度取り込んでください（取込済みの行は重複しません）']
      }
    }
  })
  return summarize(false, rows)
}
