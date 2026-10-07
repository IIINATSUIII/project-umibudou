import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { DataStoreError, store, USE_POSTGRES } from '@/lib/dataStore'
import type { QuestionnaireData, QuestionnaireFormData, Customer } from '@/types'
import { nextCustomerId } from '@/lib/questionnaireUtils'
import { findReservationByQuestionnaireToken, getQrError } from '@/lib/questionnaireToken'
import { isQuestionnaireReservationAllowed } from '@/lib/reservationStatus'
import { completedQuestionnairesForReservation, hasAllGuestQuestionnaires } from '@/lib/questionnaireCompletion'
import { validateSubmission } from '@/lib/questionnaireSubmission'
import { normalizeQuestionnaireExperience } from '@/lib/questionnaireExperience'
import { StoreBusyError, withStoreWriteLock } from '@/lib/storeLock'
import { MSG } from '@/lib/messages'
import { RateLimitedError } from '@/lib/withRetry'

export const runtime = 'nodejs'

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

function countedReservationIds(customer: Customer, questionnaires: QuestionnaireData[]): string[] {
  const reservationByQuestionnaireId = new Map(
    questionnaires.map((questionnaire) => [questionnaire.id, questionnaire.reservationId] as const)
  )
  const parseIds = (value?: string): string[] => {
    try {
      const ids: unknown = JSON.parse(value ?? '[]')
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }
  // 旧版は問診IDを保存していたため、問診行から予約IDへ変換してから重複判定する。
  const reservationIds = [
    ...parseIds(customer.countedReservationIds),
    ...parseIds(customer.countedQuestionnaireIds),
  ].map((id) => reservationByQuestionnaireId.get(id) ?? id)
  return reservationIds.filter((id, index) => reservationIds.indexOf(id) === index)
}

function healthNotes(questionnaire: QuestionnaireData): string {
  return [
    questionnaire.heartDisease       && '心臓疾患',
    questionnaire.highBloodPressure  && '高血圧',
    questionnaire.respiratoryDisease && '呼吸器疾患',
    questionnaire.earDisease         && '耳の疾患',
    questionnaire.epilepsy           && 'てんかん',
    questionnaire.diabetes           && '糖尿病',
    questionnaire.pregnant           && '妊娠中',
    questionnaire.panicDisorder      && 'パニック障害',
    questionnaire.medication         && `服薬：${questionnaire.medicationName}`,
    questionnaire.latexAllergy       && 'ラテックスアレルギー',
  ].filter(Boolean).join('、') || '特記なし'
}

const LAST_DIVE_OPTIONS = ['1ヶ月以内', '半年以内', '1年以内', '1年以上', '初めて']

export const dynamic = 'force-dynamic'

function successPayload(questionnaire: QuestionnaireData) {
  return {
    ok: true,
    questionnaireId: questionnaire.id,
    qrToken: questionnaire.qrToken,
    qrExpiresAt: questionnaire.qrExpiresAt,
    lastName: questionnaire.lastName,
    firstName: questionnaire.firstName,
    lastNameKana: questionnaire.lastNameKana,
    firstNameKana: questionnaire.firstNameKana,
  }
}

function successResponse(questionnaire: QuestionnaireData): NextResponse {
  return NextResponse.json(successPayload(questionnaire), {
    headers: { 'Cache-Control': 'no-store' },
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

export async function POST(req: NextRequest) {
  if (USE_POSTGRES) return handlePost(req)
  try {
    // Legacy Sheets/JSON stores need the shared lock for the multi-write flow.
    // PostgreSQL uses the cross-instance transaction in submitPublicQuestionnaire.
    return await withStoreWriteLock(() => handlePost(req))
  } catch (err) {
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: err.message }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json({ error: '保存結果を確認できません。時間をおいて再送してください' }, { status: 500 })
  }
}

/** Newer questionnaire pages use the opaque reservation access token. */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('accessToken') || ''
    const reservation = findReservationByQuestionnaireToken(
      await store.getReservations(),
      token,
    )
    if (!reservation) {
      return NextResponse.json(
        { error: '予約URLが無効、または期限切れです' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const questionnaires = await store.getQuestionnaires()
    const completedQuestionnaires = completedQuestionnairesForReservation(reservation, questionnaires)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    const questionnaire = completedQuestionnaires[0]
    const submitted = hasAllGuestQuestionnaires(reservation, questionnaires)
    if (submitted && questionnaire && getQrError(questionnaire)) {
      return NextResponse.json(
        { error: '受付QRが使用済みまたは期限切れです' },
        { status: 410, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(
      submitted && questionnaire
        ? { ...successPayload(questionnaire), submitted: true }
        : { submitted: false },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json(
        { error: MSG.RATE_LIMITED },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    return NextResponse.json(
      { error: '送信状態を確認できませんでした' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }
    const values = body as Record<string, unknown>
    const accessToken = stringValue(values.accessToken)
    if (!accessToken) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
    }
    const reservationToken = accessToken
    const submissionId = stringValue(values.submissionId)

    // 実在する予約に対する提出のみ受け付ける
    const reservations = await store.getReservations()
    const reservation = reservations.find((r) => r.questionnaireToken === accessToken)
    const resolvedReservationId = reservation?.id ?? ''
    if (
      !reservation ||
      !isQuestionnaireReservationAllowed(reservation.status) ||
      !reservation.questionnaireToken ||
      reservationToken !== reservation.questionnaireToken
    ) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
    }

    const questionnaires = await store.getQuestionnaires()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
      return NextResponse.json({ error: '送信IDが不正です。ページを再読み込みしてください' }, { status: 400 })
    }
    const priorQuestionnaire = questionnaires.find(
      (questionnaire) => questionnaire.submissionId === submissionId
    )
    if (priorQuestionnaire && priorQuestionnaire.reservationId !== resolvedReservationId) {
      return NextResponse.json({ error: '送信IDは別の予約で使用済みです' }, { status: 409 })
    }
    if (priorQuestionnaire?.submissionState === 'complete' && getQrError(priorQuestionnaire)) {
      return NextResponse.json(
        { error: '受付QRが使用済みまたは期限切れです' },
        { status: 410, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // 同じ送信IDですでに保存済みの問診票は、部分失敗からの再開として期限後も処理する。
    // 新規票は保存された期限が有効な場合だけ受け付ける。
    if (!priorQuestionnaire) {
      const expiryValue = reservation.questionnaireTokenExpiresAt
      const expiry = expiryValue ? new Date(expiryValue) : null
      if (
        !expiry ||
        !Number.isFinite(expiry.getTime()) ||
        expiry.toISOString() !== expiryValue ||
        expiry.getTime() <= Date.now()
      ) {
        return NextResponse.json({ error: '問診票URLの有効期限が切れています' }, { status: 410 })
      }
    }

    const modernForm = values.sleepCategory !== undefined || values.lastDivePeriod !== undefined
    const experience = modernForm
      ? normalizeQuestionnaireExperience(values)
      : undefined
    const gender = values.gender
    const condition = values.condition
    const sleepHours = Number(values.sleepHours)
    const totalDives = Number(values.totalDives)
    if (modernForm) {
      const errors = validateSubmission(values)
      if (Object.keys(errors).length) {
        return NextResponse.json(
          { error: '入力内容を確認してください', errors },
          { status: 400 },
        )
      }
    } else if (
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
      highBloodPressure: values.highBloodPressure === true || values.hypertension === true,
      hypertension: values.hypertension === true || values.highBloodPressure === true,
      medicalCertificate: values.medicalCertificate === true,
      respiratoryDisease: values.respiratoryDisease === true,
      earDisease: values.earDisease === true,
      epilepsy: values.epilepsy === true,
      diabetes: values.diabetes === true,
      pregnant: values.pregnant === true,
      panicDisorder: values.panicDisorder === true,
      medication: values.medication === true,
      medicationName: stringValue(values.medicationName),
      latexAllergy: values.latexAllergy === true,
      sleepHours: modernForm ? null : sleepHours,
      sleepCategory: stringValue(values.sleepCategory),
      alcoholLastNight: values.alcoholLastNight === true,
      alcoholToday: values.alcoholToday === true,
      condition: condition as QuestionnaireFormData['condition'],
      conditionDetails: stringValue(experience?.conditionDetails ?? values.conditionDetails),
      flightWithin48h: values.flightWithin48h === true,
      hasCCard: values.hasCCard === true,
      cCardType: stringValue(values.cCardType),
      cCardOrg: stringValue(experience?.cCardOrg ?? values.cCardOrg),
      lastDiveDate: modernForm ? '' : stringValue(values.lastDiveDate),
      lastDivePeriod: stringValue(values.lastDivePeriod) || stringValue(values.lastDiveDate),
      totalDives: modernForm
        ? (typeof values.totalDives === 'number' ? values.totalDives : null)
        : totalDives,
      agreeRisk: values.agreeRisk === true,
      agreeMedical: values.agreeMedical === true,
      agreePhoto: values.agreePhoto === true,
    }
    if (!modernForm && (
      !formData.lastName || !formData.firstName || !formData.birthDate ||
      !formData.lastNameKana || !formData.firstNameKana || !formData.email ||
      !formData.address || !formData.phone || !formData.emergencyName ||
      !formData.emergencyRelation || !formData.emergencyPhone ||
      !formData.agreeRisk || !formData.agreeMedical ||
      !LAST_DIVE_OPTIONS.includes(formData.lastDiveDate) ||
      (formData.condition === 'bad' && !formData.conditionDetails) ||
      (formData.medication && !formData.medicationName) ||
      (formData.hasCCard && !formData.cCardType) ||
      (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) ||
      !isValidPhone(formData.phone) ||
      !isValidPhone(formData.emergencyPhone) ||
      (formData.conditionDetails?.length ?? 0) > 500
    )) {
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

    if (USE_POSTGRES) {
      if (!store.submitPublicQuestionnaire) {
        throw new Error('PostgreSQL datastore does not provide transactional questionnaire submission')
      }
      try {
        const result = await store.submitPublicQuestionnaire({
          reservationId: resolvedReservationId,
          reservationToken,
          submissionId,
          formData,
        })
        return successResponse(result.questionnaire)
      } catch (error) {
        if (error instanceof DataStoreError) {
          if (error.code === 'reservation_not_found') {
            return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
          }
          if (error.code === 'questionnaire_expired') {
            return NextResponse.json({ error: '問診票URLの有効期限が切れています' }, { status: 410 })
          }
          if (error.code === 'submission_conflict') {
            return NextResponse.json({ error: '送信IDは別の予約で使用済みです' }, { status: 409 })
          }
        }
        throw error
      }
    }

    const customers = await store.getCustomers()
    // 送信IDで同じ参加者の再試行だけを識別し、同じ予約の別参加者は別票として保存する。
    const source = priorQuestionnaire ?? formData
    const email = (source.email ?? '').trim().toLocaleLowerCase('ja-JP')
    const phone = normalizedPhone(source.phone)
    const existingById = priorQuestionnaire?.customerId
      ? customers.find((customer) => customer.id === priorQuestionnaire.customerId)
      : undefined
    const existingByEmail = email
      ? customers.find((customer) => (customer.email ?? '').trim().toLocaleLowerCase('ja-JP') === email)
      : undefined
    const existingByPhone = customers.find((customer) =>
      !(customer.email ?? '').trim() &&
      normalizedPhone(customer.phone) === phone &&
      customer.lastName === source.lastName &&
      customer.firstName === source.firstName
    )
    const emailIdentityConflict = Boolean(!existingById && (existingByEmail || existingByPhone))
    const existing = existingById ?? (emailIdentityConflict ? undefined : existingByEmail ?? existingByPhone)
    const customerId = priorQuestionnaire?.customerId ?? (emailIdentityConflict
      ? undefined
      : existing?.id ?? nextCustomerId(customers.map((customer) => customer.id)))
    const submittedAt = priorQuestionnaire?.submittedAt ?? new Date().toISOString()
    const qData = priorQuestionnaire
      ? emailIdentityConflict && priorQuestionnaire.staffReviewStatus !== '要対応'
        ? await store.updateQuestionnaire(priorQuestionnaire.id, {
            staffReviewStatus: '要対応',
            staffReviewNotes: '既存顧客情報と一致しました。本人確認後に顧客台帳へ反映してください。',
          })
        : priorQuestionnaire
      : await store.addQuestionnaire({
          ...formData,
          reservationId: resolvedReservationId,
          customerId,
          submissionId,
          submittedAt,
          consentAt: submittedAt,
          qrToken: randomBytes(16).toString('base64url'),
          qrExpiresAt: qrExpiryForDiveDate(reservation.diveDate),
          qrUsed: false,
          submissionState: 'pending',
          doctorDivingPermit: '',
          staffReviewStatus: emailIdentityConflict ? '要対応' : '未確認',
          staffReviewNotes: emailIdentityConflict
            ? '既存顧客情報と一致しました。本人確認後に顧客台帳へ反映してください。'
            : '',
        })

    // 公開フォームのメール一致だけでは本人確認にならないため、既存顧客への反映は保留する。
    const today = qData.submittedAt.slice(0, 10)

    if (emailIdentityConflict) {
      // メール一致だけでは本人確認にならないため、既存顧客の情報を公開フォームから変更しない。
    } else if (!existing) {
      const newCustomer: Customer = {
        id: customerId ?? nextCustomerId(customers.map((customer) => customer.id)),
        lastName: qData.lastName,
        firstName: qData.firstName,
        lastNameKana: qData.lastNameKana,
        firstNameKana: qData.firstNameKana,
        phone: qData.phone,
        email: source.email ?? '',
        lastVisit: today,
        visitCount: 1,
        countedReservationIds: JSON.stringify([resolvedReservationId]),
        hasCCard: qData.hasCCard,
        cCardType: qData.cCardType,
        totalDives: qData.totalDives,
        healthNotes: healthNotes(qData),
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
        lastDivePeriod: qData.lastDivePeriod || qData.lastDiveDate,
        dmConsent: '',
      }
      await store.addCustomer(newCustomer)
    } else {
      const countedIds = countedReservationIds(existing, questionnaires)
      const alreadyCounted = countedIds.includes(resolvedReservationId)
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
        healthNotes: healthNotes(qData),
        hasCCard: qData.hasCCard,
        cCardType: qData.cCardType,
        cCardOrg: qData.cCardOrg,
        totalDives: qData.totalDives,
        lastDivePeriod: qData.lastDivePeriod || qData.lastDiveDate,
        visitCount: alreadyCounted ? existing.visitCount : existing.visitCount + 1,
        countedReservationIds: JSON.stringify(
          alreadyCounted ? countedIds : [...countedIds, resolvedReservationId]
        ),
        lastVisit: existing.lastVisit > today ? existing.lastVisit : today,
        updatedAt: submittedAt,
      })
    }

    // 予約に全参加者の問診票IDを保持し、従来画面向けの単一IDも最新票へ更新する。
    const questionnaireIds = new Set<string>(
      [reservation.questionnaireId, ...(reservation.questionnaireIds ?? '').split('|'),
        ...questionnaires.filter((questionnaire) => questionnaire.reservationId === resolvedReservationId).map((questionnaire) => questionnaire.id),
        qData.id]
        .filter((value): value is string => Boolean(value))
    )
    await store.updateReservation(resolvedReservationId, {
      questionnaireId: qData.id,
      questionnaireIds: Array.from(questionnaireIds).join('|'),
      questionnaireCompleted: true,
    })

    const completed = await store.updateQuestionnaire(qData.id, {
      submissionState: 'complete',
    })

    return successResponse(completed)
  } catch (err) {
    if (err instanceof StoreBusyError) {
      return NextResponse.json({ error: err.message }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: MSG.RATE_LIMITED }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json(
      { error: '保存結果を確認できません。時間をおいて再送してください' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
