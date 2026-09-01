import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { MSG } from '@/lib/messages'
import { pickEditableFields, validateCustomerUpdate } from '@/lib/customerValidation'

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
    await store.addCustomer({ ...body, updatedAt: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/customers]', err)
    return NextResponse.json({ error: 'Failed to add customer' }, { status: 500 })
  }
}

/**
 * PATCH /api/customers — 顧客情報編集（詳細設計書 4-4「顧客情報編集」）
 *
 * body: { id, expectedUpdatedAt?, force?, ...更新する列 }
 *  - 更新できるのは EDITABLE_CUSTOMER_FIELDS の列のみ（ID・来店回数などの自動更新項目は無視）
 *  - サーバーサイドでバリデーションし、保存時に最終更新日時を記録する
 *  - expectedUpdatedAt が最新と食い違う場合は 409（MSG-20）。force: true で後勝ち上書き
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: '顧客IDが指定されていません。' },
        { status: 400 }
      )
    }

    const all = await store.getCustomers()
    const current = all.find((c) => c.id === id)
    if (!current) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: '対象の顧客が見つかりません。' },
        { status: 404 }
      )
    }

    // 排他制御：原則は後勝ちだが、他スタッフの更新を検知したら一度確認を促す（MSG-20）
    const expectedUpdatedAt = body.expectedUpdatedAt
    if (
      body.force !== true &&
      typeof expectedUpdatedAt === 'string' &&
      (current.updatedAt ?? '') !== expectedUpdatedAt
    ) {
      return NextResponse.json(
        { error: 'CONFLICT', message: MSG.CONFLICT, customer: current },
        { status: 409 }
      )
    }

    const delta = pickEditableFields(body)
    if (Object.keys(delta).length === 0) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: '更新する項目がありません。' },
        { status: 400 }
      )
    }

    const fields = validateCustomerUpdate(delta, current, all)
    if (Object.keys(fields).length > 0) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: '入力内容を確認してください。', fields },
        { status: 400 }
      )
    }

    const updatedAt = new Date().toISOString()
    await store.updateCustomer(id, { ...delta, updatedAt })

    return NextResponse.json({
      ok: true,
      message: MSG.SAVED,
      customer: { ...current, ...delta, updatedAt },
    })
  } catch (err) {
    console.error('[PATCH /api/customers]', err)
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}
