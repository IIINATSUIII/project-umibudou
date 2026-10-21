import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Reservation } from '@/types'

const db = vi.hoisted(() => ({ rows: [] as Reservation[], failIds: new Set<string>() }))
vi.mock('../dataStore', () => ({
  store: {
    getReservations: async () => db.rows.map((row) => ({ ...row })),
    addReservation: async (row: Reservation) => {
      if (db.failIds.has(row.id)) throw new Error('write failed')
      if (db.rows.some((r) => r.id === row.id)) throw new Error('duplicate')
      db.rows.push(row)
      return row
    },
  },
  USE_SHEETS: false,
}))
vi.mock('../storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => work(),
}))

import { parseCsv, CsvFormatError } from '../csvParse'
import { importOtaCsv, parseGuestCount, parseTimeSlot, resolveCourseId } from '../otaCsvImport'

const header = '予約番号,利用日,開始時間,プラン名,代表者氏名,電話番号,メールアドレス,人数,備考'
const row1 = 'J-1001,2026/11/03,09:00,【青の洞窟】体験ダイビング,山田 太郎,090-1234-5678,taro@example.com,2名,"初めてです, よろしく"'
const row2 = 'J-1002,2026-11-04,13:30,ファンダイビング（2本）,"佐藤 ""さっちゃん"" 花子",080-0000-1111,hanako@example.com,大人1名 子供1名,"アレルギー:\nエビ"'
const csv = (...rows: string[]) => [header, ...rows].join('\r\n') + '\r\n'

beforeEach(() => {
  db.rows = []
  db.failIds.clear()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('parseCsv', () => {
  it('引用符・カンマ・セル内改行・""・BOM・CRLFを扱う', () => {
    const records = parseCsv('﻿a,b\r\n"x, y","say ""hi""\nnext"\r\nlast,1')
    expect(records).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['x, y', 'say "hi"\nnext'] },
      { line: 4, cells: ['last', '1'] },
    ])
  })

  it('空行は読み飛ばし、LFのみ・CRのみの改行も扱う', () => {
    expect(parseCsv('a\n\nb\rc\n').map((r) => r.cells)).toEqual([['a'], ['b'], ['c']])
  })

  it('閉じていない引用符・余分な文字は形式エラー', () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(CsvFormatError)
    expect(() => parseCsv('a,"b"x')).toThrow(CsvFormatError)
    expect(() => parseCsv('a,b"c"')).toThrow(CsvFormatError)
  })
})

describe('列の値の解釈', () => {
  it('人数・時間帯・プラン名', () => {
    expect(parseGuestCount('2')).toBe(2)
    expect(parseGuestCount('２名')).toBe(2)
    expect(parseGuestCount('大人2名 子供1名')).toBe(3)
    expect(parseGuestCount('多数')).toBeNull()
    expect(parseTimeSlot('09:00')).toEqual({ timeSlot: 'morning', time: '09:00' })
    expect(parseTimeSlot('13:30〜')).toEqual({ timeSlot: 'afternoon', time: '13:30' })
    expect(parseTimeSlot('午前の部')).toEqual({ timeSlot: 'morning' })
    expect(parseTimeSlot('')).toEqual({ timeSlot: 'unspecified' })
    expect(resolveCourseId('ファンダイビング（3本）')).toBe('CRS-003')
    expect(resolveCourseId('【沖縄】ナイトダイビング♪')).toBe('CRS-004')
    expect(resolveCourseId('CRS-001')).toBe('CRS-001')
    expect(resolveCourseId('サンセットクルーズ')).toBeUndefined()
  })
})

describe('importOtaCsv', () => {
  it('有効な行を予約一覧へOTAとして追加する（日本語・引用符・改行入りセル）', async () => {
    const result = await importOtaCsv(csv(row1, row2))

    expect(result).toMatchObject({ dryRun: false, imported: 2, duplicates: 0, invalid: 0 })
    expect(db.rows).toHaveLength(2)
    expect(db.rows[0]).toMatchObject({
      diveDate: '2026-11-03', timeSlot: 'morning', time: '09:00', courseId: 'CRS-001',
      courseName: '体験ダイビング', guestName: '山田 太郎', guestCount: 2, channel: 'ota', status: 'STS-03',
    })
    expect(db.rows[0].staffNote).toContain('予約番号: J-1001')
    expect(db.rows[0].staffNote).toContain('プラン: 【青の洞窟】体験ダイビング')
    expect(db.rows[0].staffNote).toContain('初めてです, よろしく')
    expect(db.rows[1]).toMatchObject({ guestName: '佐藤 "さっちゃん" 花子', guestCount: 2, timeSlot: 'afternoon' })
    expect(db.rows[1].staffNote).toContain('アレルギー:\nエビ')
    expect(db.rows[0].questionnaireToken).toBeTruthy()
  })

  it('同じファイルを再取込しても重複しない', async () => {
    await importOtaCsv(csv(row1, row2))
    const again = await importOtaCsv(csv(row1, row2))

    expect(again).toMatchObject({ imported: 0, duplicates: 2 })
    expect(again.rows.map((r) => r.messages[0])).toEqual(['取込済みの予約です', '取込済みの予約です'])
    expect(db.rows).toHaveLength(2)
  })

  it('予約番号が無いCSVでも、同じ内容の行は再取込で重複しない', async () => {
    const file = [
      '利用日,プラン名,氏名,電話番号,メールアドレス,人数',
      '2026/11/05,体験ダイビング,鈴木 一郎,090-1111-2222,ichiro@example.com,1',
    ].join('\n')
    expect((await importOtaCsv(file)).imported).toBe(1)
    expect((await importOtaCsv(file)).duplicates).toBe(1)
    expect(db.rows).toHaveLength(1)
  })

  it('ファイル内の重複行は1件だけ取り込む', async () => {
    const result = await importOtaCsv(csv(row1, row1))
    expect(result).toMatchObject({ imported: 1, duplicates: 1 })
    expect(result.rows[1].messages).toEqual(['2行目と同じ予約です'])
  })

  it('不正な行は取り込まず行番号と理由を返し、正常な行と既存データはそのまま', async () => {
    db.rows.push({ id: 'R-EXISTING', diveDate: '2026-10-01', guestName: '既存', guestPhone: '090', guestCount: 1,
      timeSlot: 'morning', courseName: '体験ダイビング', status: 'STS-03', channel: 'phone' })
    const bad = 'J-9,2026/13/40,09:00,サンセットクルーズ,,abc,not-mail,0名,'
    const result = await importOtaCsv(csv(row1, bad))

    expect(result).toMatchObject({ imported: 1, invalid: 1 })
    const invalid = result.rows.find((r) => r.status === 'invalid')!
    expect(invalid.line).toBe(3)
    expect(invalid.messages).toEqual(expect.arrayContaining([
      '利用日を日付として読み取れません',
      'プラン「サンセットクルーズ」に対応するコースがありません',
      '代表者氏名を入力してください',
      '電話番号は数字とハイフンのみで入力してください',
      'メールアドレスの形式が正しくありません',
      '人数は1〜20名の整数で入力してください',
    ]))
    expect(db.rows.map((r) => r.id)).toContain('R-EXISTING')
    expect(db.rows).toHaveLength(2)
  })

  it('列数が見出しより少ない行は不正。行末の空セルは許容する', async () => {
    const short = 'J-2,2026/11/03,09:00'
    const trailing = row1.replace('J-1001', 'J-3') + ',,'
    const result = await importOtaCsv(csv(short, trailing))
    expect(result.rows[0]).toMatchObject({ status: 'invalid' })
    expect(result.rows[0].messages[0]).toContain('列の数が見出しと一致しません')
    expect(result.rows[1]).toMatchObject({ status: 'imported' })
  })

  it('dryRun は保存せず取込予定・重複を返す', async () => {
    await importOtaCsv(csv(row1))
    const preview = await importOtaCsv(csv(row1, row2), { dryRun: true })
    expect(preview).toMatchObject({ dryRun: true, ready: 1, duplicates: 1, imported: 0 })
    expect(db.rows).toHaveLength(1)
  })

  it('必須列が無い・空・形式不正のファイルは MSG-14 の形式エラー', async () => {
    await expect(importOtaCsv('予約番号,利用日\nJ-1,2026/11/03')).rejects.toThrow(/必要な列がありません: プラン名／コース、代表者氏名/)
    await expect(importOtaCsv('')).rejects.toThrow(CsvFormatError)
    await expect(importOtaCsv(header)).rejects.toThrow('予約の行がありません')
    await expect(importOtaCsv(`${header}\n"unterminated`)).rejects.toThrow(CsvFormatError)
    expect(db.rows).toHaveLength(0)
  })

  it('保存に失敗した行だけ失敗として返し、再取込で残りを取り込める', async () => {
    const first = await importOtaCsv(csv(row1, row2), { dryRun: true })
    db.failIds.add(first.rows[1].reservationId!)
    const result = await importOtaCsv(csv(row1, row2))
    expect(result).toMatchObject({ imported: 1, invalid: 1 })

    db.failIds.clear()
    expect(await importOtaCsv(csv(row1, row2))).toMatchObject({ imported: 1, duplicates: 1 })
    expect(db.rows).toHaveLength(2)
  })
})
