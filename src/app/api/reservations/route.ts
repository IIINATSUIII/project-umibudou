import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { importGoogleFormBookings } from '@/lib/googleFormImport'

/** GET /api/reservations — 予約一覧取得 */
export async function GET() {
  try {
    // Google Forms回答シートを先に同期し、一覧取得時に新着予約を自動反映する。
    const result = await importGoogleFormBookings()
    if (result.errors.length > 0) {
      console.warn('[GET /api/reservations] Googleフォーム取込:', result.errors)
    }
    return NextResponse.json(await store.getReservations())
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}

/** POST /api/reservations — 予約追加 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await store.addReservation(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to add reservation' }, { status: 500 })
  }
}

/** PATCH /api/reservations — 予約更新（idとdeltaをbodyに渡す） */
export async function PATCH(req: NextRequest) {
  try {
    const { id, ...delta } = await req.json()
    await store.updateReservation(id, delta)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/reservations]', err)
    return NextResponse.json({ error: 'Failed to update reservation' }, { status: 500 })
  }
}
