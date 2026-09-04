import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData, RosterEntry } from '@/types'
import { randomUUID } from 'crypto'

let rosterWriteLock = Promise.resolve()

async function withRosterWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = rosterWriteLock
  let release!: () => void
  rosterWriteLock = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await work() } finally { release() }
}

function ageAt(birthDate: string, date: string): number {
  const birth = new Date(`${birthDate}T00:00:00+09:00`)
  const on = new Date(`${date}T00:00:00+09:00`)
  let age = on.getFullYear() - birth.getFullYear()
  const beforeBirthday = on.getMonth() < birth.getMonth() ||
    (on.getMonth() === birth.getMonth() && on.getDate() < birth.getDate())
  if (beforeBirthday) age--
  return Math.max(0, age)
}

function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, '')
}

/** GET /api/roster — 名簿一覧（スタッフ専用） */
export async function GET() {
  return NextResponse.json(await store.getRoster())
}

/** POST /api/roster — 問診・予約・顧客を名簿へ追加（スタッフ専用） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { questionnaireId?: string; qrToken?: string; method?: RosterEntry['checkInMethod'] }
    const questionnaireId = String(body.questionnaireId ?? '')
    if (body.method !== 'QR読取' && body.method !== '手動照合') {
      return NextResponse.json({ error: '受付方法が不正です' }, { status: 400 })
    }
    const method = body.method
    const result = await withRosterWriteLock(async () => {
      const [questionnaires, reservations, customers, roster] = await Promise.all([
        store.getQuestionnaires(), store.getReservations(), store.getCustomers(), store.getRoster(),
      ])
      const q = questionnaires.find((item) => item.id === questionnaireId) as QuestionnaireData | undefined
      if (!q) return { error: '問診情報が見つかりません' }
      if (method === 'QR読取') {
        if (!body.qrToken || body.qrToken !== q.qrToken) return { error: 'QRコードが無効です' }
        if (q.qrUsed) return { error: 'MSG-22：このQRコードは受付済みです。' }
        if (q.qrExpiresAt && new Date(q.qrExpiresAt).getTime() < Date.now()) return { error: 'MSG-10：QRコードの有効期限が切れています。' }
      }
      const reservation = reservations.find((item) => item.id === q.reservationId)
      if (!reservation) return { error: '予約情報が見つかりません' }
      const existing = roster.find((item) => item.questionnaireId === q.id)
      if (existing) return { ok: true, entry: existing, alreadyExists: true }
      const customer = customers.find((item) => normalizePhone(item.phone) === normalizePhone(q.phone) || `${item.lastName} ${item.firstName}` === `${q.lastName} ${q.firstName}`)
      const entry: RosterEntry = {
        id: `L-${randomUUID()}`,
        diveDate: reservation.date, reservationId: reservation.id, questionnaireId: q.id, customerId: customer?.id ?? '',
        name: `${q.lastName} ${q.firstName}`, nameKana: `${q.lastNameKana} ${q.firstNameKana}`, birthDate: q.birthDate,
        age: ageAt(q.birthDate, reservation.date), gender: q.gender, address: q.address, phone: q.phone,
        emergencyContact: `${q.emergencyName}（${q.emergencyRelation}）`, emergencyPhone: q.emergencyPhone,
        course: reservation.course, staffName: '', checkedInAt: new Date().toISOString(), checkInMethod: method,
      }
      await store.addRoster(entry)
      // 手動照合でも名簿に追加された問診は再受付不可とする。
      if (!q.qrUsed) await store.updateQuestionnaire(q.id, { qrUsed: true })
      return { ok: true, entry }
    })
    if (result.error) {
      const errorMessage = result.error
      const status = errorMessage.includes('MSG-22') ? 409 : errorMessage.includes('問診情報') || errorMessage.includes('予約情報') ? 404 : 400
      return NextResponse.json({ error: errorMessage }, { status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/roster]', err)
    return NextResponse.json({ error: '名簿への追加に失敗しました' }, { status: 500 })
  }
}
