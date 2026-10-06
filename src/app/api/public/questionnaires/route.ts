import { NextRequest, NextResponse } from 'next/server'
import { createToken, getQuestionnaireExpiry, findReservationByQuestionnaireToken, isQrValid, withQuestionnaireLock } from '@/lib/questionnaireToken'
import { validateQuestionnaireInput } from '@/lib/questionnaireValidation'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData, Customer } from '@/types'
import { nextCustomerId } from '@/lib/questionnaireUtils'

function normalizedPhone(value: string): string {
  return value.normalize('NFKC').replace(/\D/g, '')
}

function countedQuestionnaireIds(customer: Customer): string[] {
  try {
    const ids: unknown = JSON.parse(customer.countedQuestionnaireIds ?? '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function successResponse(questionnaire: QuestionnaireData): NextResponse {
  return NextResponse.json({
    ok: true,
    questionnaireId: questionnaire.id,
    qrToken: questionnaire.qrToken,
    qrExpiresAt: questionnaire.qrExpiresAt,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * POST /api/public/questionnaires — 問診票提出（ログイン不要）
 * 提出に伴う「予約への紐付け」「顧客台帳への反映」はすべてサーバー側で行う。
 * 客側に顧客台帳を読ませない・予約を任意に書き換えさせないための境界。
 */
export async function POST(req: NextRequest) {
  return withQuestionnaireLock(() => handlePost(req))
}

export async function GET(req: NextRequest) {
  try {
    const reservation = findReservationByQuestionnaireToken(await store.getReservations(), req.nextUrl.searchParams.get('accessToken'))
    if (!reservation) return NextResponse.json({ error: '問診URLが無効または期限切れです' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    const q = (await store.getQuestionnaires()).find((item) => item.id === reservation.questionnaireId)
    if (!q) return NextResponse.json({ submitted: false }, { headers: { 'Cache-Control': 'no-store' } })
    if (!isQrValid(q)) return NextResponse.json({ error: '受付QRが使用済みまたは期限切れです' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json({ submitted: true, questionnaireId: q.id, qrToken: q.qrToken, qrExpiresAt: q.qrExpiresAt,
      lastName: q.lastName, firstName: q.firstName, lastNameKana: q.lastNameKana, firstNameKana: q.firstNameKana }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: '問診URLを確認できませんでした' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const reservation = findReservationByQuestionnaireToken(await store.getReservations(), values.accessToken)
    if (!reservation) return NextResponse.json({ error: '問診URLが無効または期限切れです' }, { status: 404 })
    const reservationId = reservation.id
    const validation = validateQuestionnaireInput(values)
    if (!validation.ok) return NextResponse.json({ error: '入力内容を確認してください', errors: validation.errors }, { status: 400 })
    const formData = validation.data

    const customers = await store.getCustomers()
    const questionnaires = await store.getQuestionnaires()
    const priorQuestionnaire = questionnaires.find(
      (questionnaire) => questionnaire.id === reservation.questionnaireId
    ) ?? questionnaires.find((questionnaire) => questionnaire.reservationId === reservationId)
    if (priorQuestionnaire && reservation.questionnaireId === priorQuestionnaire.id) {
      if (!isQrValid(priorQuestionnaire)) return NextResponse.json({ error: '受付QRが使用済みまたは期限切れです' }, { status: 410 })
      return successResponse(priorQuestionnaire)
    }

    // 予約IDを冪等キーとして扱い、途中失敗後の再送では問診票行を再利用する。
    const source = priorQuestionnaire ?? formData
    const email = (source.email ?? '').trim().toLocaleLowerCase('ja-JP')
    const phone = normalizedPhone(source.phone)
    const existingById = priorQuestionnaire?.customerId
      ? customers.find((customer) => customer.id === priorQuestionnaire.customerId)
      : undefined
    const existingByEmail = email
      ? customers.find((customer) => (customer.email ?? '').trim().toLocaleLowerCase('ja-JP') === email)
      : undefined
    const existing = existingById ?? existingByEmail ?? customers.find((customer) =>
      !(customer.email ?? '').trim() &&
      normalizedPhone(customer.phone) === phone &&
      customer.lastName === source.lastName &&
      customer.firstName === source.firstName
    )
    const customerId = priorQuestionnaire?.customerId ?? existing?.id ??
      nextCustomerId(customers.map((customer) => customer.id))
    const submittedAt = priorQuestionnaire?.submittedAt ?? new Date().toISOString()
    const qData = priorQuestionnaire ?? await store.addQuestionnaire({
      ...formData,
      reservationId,
      customerId,
      submittedAt,
      consentAt: submittedAt,
      qrToken: createToken(),
      qrIssuedAt: submittedAt,
      qrExpiresAt: getQuestionnaireExpiry(reservation.date),
      qrUsed: false,
      doctorClearance: '',
      staffReviewStatus: '未確認',
      staffReviewNotes: '',
    })

    // 問診票は顧客台帳のメールアドレスを優先し、電話番号を副キーとして紐付ける。
    const today = qData.submittedAt.slice(0, 10)

    if (!existing) {
      const newCustomer: Customer = {
        id: customerId,
        lastName: qData.lastName,
        firstName: qData.firstName,
        lastNameKana: qData.lastNameKana,
        firstNameKana: qData.firstNameKana,
        phone: qData.phone,
        email: formData.email ?? '',
        lastVisit: today,
        visitCount: 1,
        countedQuestionnaireIds: JSON.stringify([qData.id]),
        hasCCard: qData.hasCCard,
        cCardType: qData.cCardType,
        totalDives: qData.totalDives,
        healthNotes: [
          qData.heartDisease       && '心臓疾患',
          qData.highBloodPressure  && '高血圧',
          qData.respiratoryDisease && '呼吸器疾患',
          qData.earDisease         && '耳の疾患',
          qData.epilepsy           && 'てんかん',
          qData.diabetes           && '糖尿病',
          qData.medication         && `服薬：${qData.medicationName}`,
          qData.latexAllergy       && 'ラテックスアレルギー',
        ].filter(Boolean).join('、') || '特記なし',
        guideNotes: '',
        registeredAt: submittedAt,
        updatedAt: submittedAt,
        birthDate: qData.birthDate,
        gender: qData.gender,
        postalCode: qData.postalCode,
        address: qData.address,
        emergencyName: qData.emergencyName,
        emergencyRelation: qData.emergencyRelation,
        emergencyPhone: qData.emergencyPhone,
        cCardOrg: qData.cCardOrg,
        lastDiveDate: qData.lastDiveDate,
        dmConsent: '',
      }
      await store.addCustomer(newCustomer)
    } else {
      const countedIds = countedQuestionnaireIds(existing)
      const alreadyCounted = countedIds.includes(qData.id)
      await store.updateCustomer(existing.id, {
        lastName: qData.lastName,
        firstName: qData.firstName,
        lastNameKana: qData.lastNameKana,
        firstNameKana: qData.firstNameKana,
        phone: qData.phone,
        email: source.email ?? existing.email,
        birthDate: qData.birthDate,
        gender: qData.gender,
        postalCode: qData.postalCode,
        address: qData.address,
        emergencyName: qData.emergencyName,
        emergencyRelation: qData.emergencyRelation,
        emergencyPhone: qData.emergencyPhone,
        hasCCard: qData.hasCCard,
        cCardType: qData.cCardType,
        cCardOrg: qData.cCardOrg,
        totalDives: qData.totalDives,
        lastDiveDate: qData.lastDiveDate,
        visitCount: alreadyCounted ? existing.visitCount : existing.visitCount + 1,
        countedQuestionnaireIds: alreadyCounted
          ? existing.countedQuestionnaireIds
          : JSON.stringify([...countedIds, qData.id]),
        lastVisit: today,
        updatedAt: submittedAt,
      })
    }

    // 予約に問診票IDをリンク
    await store.updateReservation(reservationId, { questionnaireId: qData.id })

    return successResponse(qData)
  } catch (err) {
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
