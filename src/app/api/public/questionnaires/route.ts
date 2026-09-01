import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import {
  upsertCustomerFromQuestionnaire,
  validateCustomerKeys,
  type CustomerSource,
} from '@/lib/customerRegistration'
import type { QuestionnaireData } from '@/types'

/**
 * POST /api/public/questionnaires — 問診票提出（ログイン不要）
 * 提出に伴う「予約への紐付け」「顧客台帳への反映」はすべてサーバー側で行う。
 * 客側に顧客台帳を読ませない・予約を任意に書き換えさせないための境界。
 *
 * 顧客自動登録（詳細設計書 4-4）：
 *  メールアドレスをユニークキー・電話番号を副キーとして顧客台帳を照合し、
 *  新規登録／既存更新のうえ、採番された顧客IDを問診回答へ書き戻す。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const reservationId = String(body.reservationId ?? '')

    // 実在する予約に対する提出のみ受け付ける
    const reservations = await store.getReservations()
    const reservation = reservations.find((r) => r.id === reservationId)
    if (!reservation) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
    }

    // 顧客台帳のキー列が欠けている行は作らない（詳細設計書 4-4 末尾）。
    // 画面側でも必須にしているが、サーバーサイドを正として検証する。
    const fields = validateCustomerKeys(body as Partial<CustomerSource>)
    if (Object.keys(fields).length > 0) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: '入力内容を確認してください。', fields },
        { status: 400 }
      )
    }

    const questionnaireId = `Q${Date.now()}`
    const qData: QuestionnaireData = {
      ...body,
      id: questionnaireId,
      reservationId,
      submittedAt: new Date().toISOString(),
    }
    await store.addQuestionnaire(qData)

    // 予約に問診票IDをリンク
    await store.updateReservation(reservationId, { questionnaireId })

    // 顧客台帳へ自動登録・更新し、顧客IDを問診回答へ書き戻す
    const { customerId } = await upsertCustomerFromQuestionnaire(store, qData)
    await store.updateQuestionnaire(questionnaireId, { customerId })

    return NextResponse.json({ ok: true, questionnaireId, customerId })
  } catch (err) {
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
