import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData, QuestionnaireFormData, Customer } from '@/types'
import { nextCustomerId } from '@/lib/questionnaireUtils'

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedPhone(value: string): string {
  return value.normalize('NFKC').replace(/\D/g, '')
}

function isValidPhone(value: string): boolean {
  const compact = value.normalize('NFKC').replace(/[\s().\-‐‑‒–—ー−]/g, '')
  return /^\+?\d{4,15}$/.test(compact)
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
  })
}

function qrExpiryForDiveDate(diveDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diveDate)) throw new Error('Invalid reservation date')
  const utcDate = new Date(`${diveDate}T00:00:00.000Z`)
  if (Number.isNaN(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== diveDate) {
    throw new Error('Invalid reservation date')
  }
  const expiry = new Date(`${diveDate}T00:00:00+09:00`)
  expiry.setUTCDate(expiry.getUTCDate() + 1)
  return expiry.toISOString()
}

/**
 * POST /api/public/questionnaires — 問診票提出（ログイン不要）
 * 提出に伴う「予約への紐付け」「顧客台帳への反映」はすべてサーバー側で行う。
 * 客側に顧客台帳を読ませない・予約を任意に書き換えさせないための境界。
 */
let submissionQueue: Promise<void> = Promise.resolve()

export async function POST(req: NextRequest) {
  let response: NextResponse | null = null
  const submit = async () => {
    response = await handlePost(req)
  }
  const pending = submissionQueue.then(submit, submit)
  submissionQueue = pending.then(() => undefined, () => undefined)
  await pending
  return response ?? NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const reservationId = stringValue(values.reservationId)

    // 実在する予約に対する提出のみ受け付ける
    const reservations = await store.getReservations()
    const reservation = reservations.find((r) => r.id === reservationId)
    if (!reservation) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
    }

    const gender = values.gender
    const condition = values.condition
    const sleepHours = Number(values.sleepHours)
    const totalDives = Number(values.totalDives)
    if (
      !['male', 'female', 'other'].includes(String(gender)) ||
      !['good', 'normal', 'bad'].includes(String(condition)) ||
      !Number.isInteger(sleepHours) || sleepHours < 1 || sleepHours > 12 ||
      !Number.isInteger(totalDives) || totalDives < 0
    ) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }

    const formData: QuestionnaireFormData = {
      lastName: stringValue(values.lastName),
      firstName: stringValue(values.firstName),
      lastNameKana: stringValue(values.lastNameKana),
      firstNameKana: stringValue(values.firstNameKana),
      birthDate: stringValue(values.birthDate),
      gender: gender as QuestionnaireFormData['gender'],
      postalCode: stringValue(values.postalCode),
      address: stringValue(values.address),
      phone: stringValue(values.phone),
      email: stringValue(values.email),
      emergencyName: stringValue(values.emergencyName),
      emergencyRelation: stringValue(values.emergencyRelation),
      emergencyPhone: stringValue(values.emergencyPhone),
      heartDisease: values.heartDisease === true,
      highBloodPressure: values.highBloodPressure === true,
      respiratoryDisease: values.respiratoryDisease === true,
      earDisease: values.earDisease === true,
      epilepsy: values.epilepsy === true,
      diabetes: values.diabetes === true,
      pregnant: values.pregnant === true,
      panicDisorder: values.panicDisorder === true,
      medication: values.medication === true,
      medicationName: stringValue(values.medicationName),
      latexAllergy: values.latexAllergy === true,
      sleepHours,
      alcoholLastNight: values.alcoholLastNight === true,
      alcoholToday: values.alcoholToday === true,
      condition: condition as QuestionnaireFormData['condition'],
      conditionDetails: stringValue(values.conditionDetails),
      flightWithin48h: values.flightWithin48h === true,
      hasCCard: values.hasCCard === true,
      cCardType: stringValue(values.cCardType),
      cCardOrg: stringValue(values.cCardOrg),
      lastDiveDate: stringValue(values.lastDiveDate),
      totalDives,
      agreeRisk: values.agreeRisk === true,
      agreeMedical: values.agreeMedical === true,
      agreePhoto: values.agreePhoto === true,
    }
    if (
      !formData.lastName || !formData.firstName || !formData.birthDate ||
      !formData.lastNameKana || !formData.firstNameKana || !formData.email ||
      !formData.address || !formData.phone || !formData.emergencyName ||
      !formData.emergencyRelation || !formData.emergencyPhone ||
      !formData.agreeRisk || !formData.agreeMedical ||
      (formData.condition === 'bad' && !formData.conditionDetails) ||
      (formData.medication && !formData.medicationName) ||
      (formData.hasCCard && !formData.cCardType) ||
      (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) ||
      !isValidPhone(formData.phone) ||
      !isValidPhone(formData.emergencyPhone) ||
      (formData.conditionDetails?.length ?? 0) > 500
    ) {
      return NextResponse.json({ error: '必須項目を入力し、必要な同意を選択してください' }, { status: 400 })
    }

    const birthDate = new Date(`${formData.birthDate}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(formData.birthDate) ||
      Number.isNaN(birthDate.getTime()) ||
      birthDate.toISOString().slice(0, 10) !== formData.birthDate ||
      formData.birthDate > new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    ) {
      return NextResponse.json({ error: '生年月日を確認してください' }, { status: 400 })
    }

    const customers = await store.getCustomers()
    const questionnaires = await store.getQuestionnaires()
    const priorQuestionnaire = questionnaires.find(
      (questionnaire) => questionnaire.id === reservation.questionnaireId
    ) ?? questionnaires.find((questionnaire) => questionnaire.reservationId === reservationId)
    if (priorQuestionnaire && reservation.questionnaireId === priorQuestionnaire.id) {
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
      qrToken: randomBytes(16).toString('base64url'),
      qrExpiresAt: qrExpiryForDiveDate(reservation.date),
      qrUsed: false,
      doctorDivingPermit: '',
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
