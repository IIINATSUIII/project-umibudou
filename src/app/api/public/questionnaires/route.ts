import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData, Customer } from '@/types'
import { BASIC_FIELDS, validateQuestionnaire } from '@/lib/questionnaireValidation'

/**
 * POST /api/public/questionnaires — 問診票提出（ログイン不要）
 * 提出に伴う「予約への紐付け」「顧客台帳への反映」はすべてサーバー側で行う。
 * 客側に顧客台帳を読ませない・予約を任意に書き換えさせないための境界。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const errors = validateQuestionnaire(body)
    if (Object.keys(errors).length) {
      return NextResponse.json({ error: '入力内容を確認してください。', errors }, { status: 400 })
    }
    if (body.agreeRisk !== true || body.agreeMedical !== true) {
      return NextResponse.json({ error: '同意事項に同意してください。' }, { status: 400 })
    }
    for (const key of BASIC_FIELDS) {
      if (typeof body[key] === 'string') body[key] = body[key].trim()
    }
    body.medicationName = body.medication ? body.medicationName.trim() : ''
    const reservationId = String(body.reservationId ?? '')

    // 実在する予約に対する提出のみ受け付ける
    const reservations = await store.getReservations()
    const reservation = reservations.find((r) => r.id === reservationId)
    if (!reservation) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
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

    // 顧客台帳に自動登録（氏名で重複チェック）
    const customers = await store.getCustomers()
    const fullName = `${qData.lastName} ${qData.firstName}`
    const existing = customers.find(
      (c) => `${c.lastName} ${c.firstName}` === fullName
    )
    const today = new Date().toISOString().slice(0, 10)

    if (!existing) {
      const newCustomer: Customer = {
        id: `C${Date.now()}`,
        lastName: qData.lastName,
        firstName: qData.firstName,
        lastNameKana: qData.lastNameKana,
        firstNameKana: qData.firstNameKana,
        phone: qData.phone,
        email: qData.email ?? '',
        lastVisit: today,
        visitCount: 1,
        hasCCard: qData.hasCCard,
        cCardType: qData.cCardType,
        totalDives: qData.totalDives,
        healthNotes: [
          qData.heartDisease       && '心臓疾患',
          qData.hypertension       && '高血圧',
          qData.respiratoryDisease && '呼吸器疾患',
          qData.earDisease         && '耳の疾患',
          qData.epilepsy           && 'てんかん',
          qData.diabetes           && '糖尿病',
          qData.medication         && `服薬：${qData.medicationName}`,
          qData.latexAllergy       && 'ラテックスアレルギー',
        ].filter(Boolean).join('、') || '特記なし',
        guideNotes: '',
      }
      await store.addCustomer(newCustomer)
    } else {
      await store.updateCustomer(existing.id, {
        visitCount: existing.visitCount + 1,
        lastVisit: today,
      })
    }

    return NextResponse.json({ ok: true, questionnaireId })
  } catch (err) {
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
