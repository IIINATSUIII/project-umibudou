import { NextRequest, NextResponse } from 'next/server'
import { store, USE_POSTGRES } from '@/lib/dataStore'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import type { Customer, QuestionnaireData } from '@/types'

export const runtime = 'nodejs'

function parseIdList(value?: string): string[] {
  try {
    const ids: unknown = JSON.parse(value ?? '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function countedReservations(customer: Customer, questionnaires: QuestionnaireData[]): string[] {
  const reservationByQuestionnaireId = new Map(
    questionnaires.map((questionnaire) => [questionnaire.id, questionnaire.reservationId] as const)
  )
  const reservationIds = [
    ...parseIdList(customer.countedReservationIds),
    ...parseIdList(customer.countedQuestionnaireIds),
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

async function isStaff(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  return Boolean(token && await verifySessionToken(token))
}

let resolutionQueue: Promise<void> = Promise.resolve()

/** GET /api/questionnaires?q=... — 条件を指定して問診票を検索 */
export async function GET(req: NextRequest) {
  try {
    if (!await isStaff(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
    if (id) {
      const questionnaire = await store.getQuestionnaireById(id)
      return questionnaire
        ? NextResponse.json(questionnaire)
        : NextResponse.json({ error: '問診票が見つかりません' }, { status: 404 })
    }

    const query = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (!query) return NextResponse.json([])
    if (query.length > 200) {
      return NextResponse.json({ error: '検索語が長すぎます' }, { status: 400 })
    }
    const matches = await store.searchQuestionnaires(query)
    const qrMatch = matches.find((questionnaire) => questionnaire.qrToken === query)
    if (qrMatch?.qrExpiresAt && new Date(qrMatch.qrExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'QR_EXPIRED' }, { status: 410 })
    }
    return NextResponse.json(matches.map((questionnaire) => ({
      id: questionnaire.id,
      reservationId: questionnaire.reservationId,
      submittedAt: questionnaire.submittedAt,
      lastName: questionnaire.lastName,
      firstName: questionnaire.firstName,
      lastNameKana: questionnaire.lastNameKana,
      firstNameKana: questionnaire.firstNameKana,
      phone: questionnaire.phone,
    })))
  } catch (err) {
    console.error('[GET /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to fetch questionnaires' }, { status: 500 })
  }
}

/** POST /api/questionnaires — 問診票提出 */
export async function POST(req: NextRequest) {
  if (!await isStaff(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as Omit<QuestionnaireData, 'id'>
    const questionnaire = await store.addQuestionnaire(body)
    return NextResponse.json({ ok: true, questionnaireId: questionnaire.id })
  } catch (err) {
    console.error('[POST /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}

/** PATCH /api/questionnaires — スタッフが本人確認後に既存顧客へ問診票を反映 */
export async function PATCH(req: NextRequest) {
  if (!await isStaff(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let response: NextResponse | null = null
  const resolve = async () => {
    response = await resolveExistingCustomer(req)
  }
  const pending = resolutionQueue.then(resolve, resolve)
  resolutionQueue = pending.then(() => undefined, () => undefined)
  await pending
  return response ?? NextResponse.json({ error: 'Failed to resolve questionnaire' }, { status: 500 })
}

async function resolveExistingCustomer(req: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力内容を確認してください' }, { status: 400 })
    }

    const values = body as Record<string, unknown>
    const questionnaireId = typeof values.questionnaireId === 'string' ? values.questionnaireId.trim() : ''
    const customerId = typeof values.customerId === 'string' ? values.customerId.trim() : ''
    if (!questionnaireId || questionnaireId.length > 64 || !customerId || customerId.length > 64) {
      return NextResponse.json({ error: '問診票IDと顧客IDを指定してください' }, { status: 400 })
    }

    if (USE_POSTGRES) {
      if (!store.resolveQuestionnaireForCustomer) {
        throw new Error('PostgreSQL datastore does not provide transactional questionnaire resolution')
      }
      const result = await store.resolveQuestionnaireForCustomer(questionnaireId, customerId)
      if (result.status === 'resolved') {
        return NextResponse.json({ ok: true, questionnaire: result.questionnaire })
      }
      if (result.status === 'not_found') {
        return NextResponse.json({ error: '問診票が見つかりません' }, { status: 404 })
      }
      if (result.status === 'customer_not_found') {
        return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 })
      }
      if (result.status === 'customer_conflict') {
        return NextResponse.json({ error: 'この問診票は別の顧客IDに紐付け済みです' }, { status: 409 })
      }
      return NextResponse.json({ error: '本人確認が必要な問診票ではありません' }, { status: 409 })
    }

    const questionnaires = await store.getQuestionnaires()
    const questionnaire = questionnaires.find((item) => item.id === questionnaireId)
    if (!questionnaire) {
      return NextResponse.json({ error: '問診票が見つかりません' }, { status: 404 })
    }

    if (questionnaire.customerId === customerId && questionnaire.staffReviewStatus !== '要対応') {
      return NextResponse.json({ ok: true, questionnaire })
    }
    if (questionnaire.staffReviewStatus !== '要対応') {
      return NextResponse.json({ error: '本人確認が必要な問診票ではありません' }, { status: 409 })
    }
    if (questionnaire.customerId && questionnaire.customerId !== customerId) {
      return NextResponse.json({ error: 'この問診票は別の顧客IDに紐付け済みです' }, { status: 409 })
    }

    const customers = await store.getCustomers()
    const customer = customers.find((item) => item.id === customerId)
    if (!customer) {
      return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 })
    }

    // 先に問診票へ顧客IDを記録する。後続の顧客更新が失敗して再試行されても
    // 別顧客へ誤って紐付けず、来店回数の処理済み予約IDで二重加算を防ぐ。
    if (!questionnaire.customerId) {
      await store.updateQuestionnaire(questionnaire.id, { customerId })
    }

    const countedIds = countedReservations(customer, questionnaires)
    const alreadyCounted = countedIds.includes(questionnaire.reservationId)
    const visitDate = questionnaire.submittedAt.slice(0, 10)
    await store.updateCustomer(customer.id, {
      lastName: questionnaire.lastName,
      firstName: questionnaire.firstName,
      lastNameKana: questionnaire.lastNameKana,
      firstNameKana: questionnaire.firstNameKana,
      birthDate: questionnaire.birthDate,
      gender: questionnaire.gender,
      postalCode: questionnaire.postalCode,
      address: questionnaire.address,
      phone: questionnaire.phone,
      email: questionnaire.email ?? customer.email,
      emergencyName: questionnaire.emergencyName,
      emergencyRelation: questionnaire.emergencyRelation,
      emergencyPhone: questionnaire.emergencyPhone,
      healthNotes: healthNotes(questionnaire),
      hasCCard: questionnaire.hasCCard,
      cCardType: questionnaire.cCardType,
      cCardOrg: questionnaire.cCardOrg,
      totalDives: questionnaire.totalDives,
      lastDivePeriod: questionnaire.lastDiveDate,
      visitCount: alreadyCounted ? customer.visitCount : customer.visitCount + 1,
      countedReservationIds: alreadyCounted
        ? JSON.stringify(countedIds)
        : JSON.stringify([...countedIds, questionnaire.reservationId]),
      lastVisit: customer.lastVisit > visitDate ? customer.lastVisit : visitDate,
      updatedAt: new Date().toISOString(),
    })

    const resolved = await store.updateQuestionnaire(questionnaire.id, {
      customerId,
      staffReviewStatus: '確認済',
      staffReviewNotes: `本人確認済み。顧客ID ${customerId} へ反映しました。`,
    })
    return NextResponse.json({ ok: true, questionnaire: resolved })
  } catch (err) {
    console.error('[PATCH /api/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to resolve questionnaire' }, { status: 500 })
  }
}
