import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'

/** GET /api/customers — 顧客一覧取得 */
export async function GET() {
  try {
    return NextResponse.json(await store.getCustomers())
  } catch (err) {
    console.error('[GET /api/customers]', err)
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
  }
}

/** POST /api/customers — 顧客登録 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await store.addCustomer(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/customers]', err)
    return NextResponse.json({ error: 'Failed to add customer' }, { status: 500 })
  }
}

/** PATCH /api/customers — 顧客情報更新（idとdeltaをbodyに渡す） */
export async function PATCH(req: NextRequest) {
  try {
    const { id, ...delta } = await req.json()
    await store.updateCustomer(id, delta)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/customers]', err)
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}
