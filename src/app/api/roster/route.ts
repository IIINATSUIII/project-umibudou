import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { RosterEntry } from '@/types'

/** 生年月日とダイブ日から満年齢を算出 */
function calcAge(birthDate: string, diveDate: string): number {
  const birth = new Date(birthDate)
  const dive = new Date(diveDate)
  let age = dive.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    dive.getMonth() < birth.getMonth() ||
    (dive.getMonth() === birth.getMonth() && dive.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

function nextRosterId(existing: RosterEntry[]): string {
  const maxSeq = existing.reduce((max, r) => {
    const m = /^L-(\d{5})$/.exec(r.id)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return `L-${String(maxSeq + 1).padStart(5, '0')}`
}

/** GET /api/roster — 名簿一覧取得（SC-09プレビュー用） */
export async function GET() {
  try {
    return NextResponse.json(await store.getRoster())
  } catch (err) {
    console.error('[GET /api/roster]', err)
    return NextResponse.json({ error: 'Failed to fetch roster' }, { status: 500 })
  }
}

/** POST /api/roster — 名簿へ1行追記（QR読取・手動照合後の「名簿追加」） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const all = await store.getRoster()

    // 同じ問診IDの重複追記を防ぐ（再スキャン・二重クリック対策）
    const dup = all.find((r) => r.questionnaireId === body.questionnaireId)
    if (dup) {
      return NextResponse.json({ ok: true, duplicate: true, id: dup.id })
    }

    const entry: RosterEntry = {
      ...body,
      id: nextRosterId(all),
      age: calcAge(body.birthDate, body.diveDate),
      receivedAt: new Date().toISOString(),
    }
    await store.addRosterEntry(entry)
    return NextResponse.json({ ok: true, id: entry.id })
  } catch (err) {
    console.error('[POST /api/roster]', err)
    return NextResponse.json({ error: 'Failed to add roster entry' }, { status: 500 })
  }
}
