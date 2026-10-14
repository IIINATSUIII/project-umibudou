import { nextUpdatedAt } from '@/lib/updateVersion'
import { requireStaffSession, staffJson } from '@/lib/staffAuth'
import { NextRequest, type NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { MSG } from '@/lib/messages'
import {
  pickEditableFields,
  validateCustomerUpdate,
} from '@/lib/customerValidation'
import { withStoreWriteLock, StoreBusyError } from '@/lib/storeLock'
import { DataStoreConflictError } from '@/lib/dataStoreErrors'

export const dynamic = 'force-dynamic'

/** GET /api/customers — 顧客一覧取得 */
export async function GET(req: NextRequest) {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response

  try {
    const query = req.nextUrl.searchParams.get('q') || ''
    return staffJson(
      query ? await store.searchCustomers(query) : await store.getCustomers()
    )
  } catch (err) {
    console.error('[GET /api/customers]', err)
    return staffJson(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    )
  }
}

/** POST /api/customers — 顧客登録 */
export async function POST(req: NextRequest) {
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    await store.addCustomer({ ...body, updatedAt: new Date().toISOString() })
    return staffJson({ ok: true })
  } catch (err) {
    console.error('[POST /api/customers]', err)
    return staffJson(
      { error: 'Failed to add customer' },
      { status: 500 }
    )
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
  const auth = await requireStaffSession(req)
  if (!auth.ok) return auth.response

  try {
    const body = (await req.json()) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) {
      return staffJson(
        { error: 'INVALID_REQUEST', message: '顧客IDが指定されていません。' },
        { status: 400 }
      )
    }

    return await withStoreWriteLock(async () => {
      const all = await store.getCustomers()
      const current = all.find((c) => c.id === id)
      if (!current) {
        return staffJson(
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
        return staffJson(
          { error: 'CONFLICT', message: MSG.CONFLICT, customer: current },
          { status: 409 }
        )
      }

      const delta = pickEditableFields(body)
      if (Object.keys(delta).length === 0) {
        return staffJson(
          { error: 'INVALID_REQUEST', message: '更新する項目がありません。' },
          { status: 400 }
        )
      }

      const fields = validateCustomerUpdate(delta, current, all)
      if (Object.keys(fields).length > 0) {
        return staffJson(
          {
            error: 'VALIDATION_ERROR',
            message: '入力内容を確認してください。',
            fields,
          },
          { status: 400 }
        )
      }

      const updatedAt = nextUpdatedAt(current.updatedAt)
      try {
        await store.updateCustomer(
          id,
          { ...delta, updatedAt },
          body.force === true ? undefined : typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : undefined,
        )
      } catch (error) {
        if (!(error instanceof DataStoreConflictError)) throw error
        const latest = (await store.getCustomers()).find((customer) => customer.id === id)
        return NextResponse.json(
          { error: 'CONFLICT', message: MSG.CONFLICT, customer: latest ?? current },
          { status: 409 }
        )
      }

      return staffJson({
        ok: true,
        message: MSG.SAVED,
        customer: { ...current, ...delta, updatedAt },
      })
    })
  } catch (err) {
    console.error('[PATCH /api/customers]', err)
    if (err instanceof StoreBusyError)
      return staffJson({ error: err.message }, { status: 503 })
    return staffJson(
      { error: 'Failed to update customer' },
      { status: 500 }
    )
  }
}
