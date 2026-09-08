import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import type { QuestionnaireData, Customer } from '@/types'
import { randomBytes, randomUUID } from 'crypto'

let questionnaireWriteLock = Promise.resolve()

async function withQuestionnaireWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = questionnaireWriteLock
  let release!: () => void
  questionnaireWriteLock = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await work() } finally { release() }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00+09:00`)
  return !Number.isNaN(date.getTime()) && date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) === value
}

function qrExpiryFor(date: string): Date {
  return new Date(new Date(`${date}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000)
}

/** GET /api/public/questionnaires?accessToken=... — 提出済みQRの再表示情報 */
export async function GET(req: NextRequest) {
  try {
    const accessToken = (req.nextUrl.searchParams.get('accessToken') ?? req.nextUrl.searchParams.get('reservationId') ?? '').trim()
    if (!accessToken) return NextResponse.json({ error: 'ページが見つかりません。URLをご確認ください。' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

    const reservations = await store.getReservations()
    const reservation = reservations.find((item) => item.questionnaireToken === accessToken || (!item.questionnaireToken && item.id === accessToken))
    if (!reservation) return NextResponse.json({ error: 'ページが見つかりません。URLをご確認ください。' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    const questionnaires = await store.getQuestionnaires()
    const questionnaire = questionnaires.find((item) => item.reservationId === reservation.id)
    if (!questionnaire) return NextResponse.json({ submitted: false }, { headers: { 'Cache-Control': 'no-store' } })
    if (!questionnaire.qrExpiresAt || new Date(questionnaire.qrExpiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'MSG-18：ページが見つかりません。URLをご確認ください。', code: 'EXPIRED' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    return NextResponse.json({
      submitted: true,
      questionnaireId: questionnaire.id,
      qrToken: questionnaire.qrToken,
      qrIssuedAt: questionnaire.qrIssuedAt,
      qrExpiresAt: questionnaire.qrExpiresAt,
      lastName: questionnaire.lastName,
      firstName: questionnaire.firstName,
      lastNameKana: questionnaire.lastNameKana,
      firstNameKana: questionnaire.firstNameKana,
      reservationDate: reservation.date,
      course: reservation.course,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[GET /api/public/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to fetch questionnaire' }, { status: 500 })
  }
}

/**
 * POST /api/public/questionnaires — 問診票提出（ログイン不要）
 * 提出に伴う「予約への紐付け」「顧客台帳への反映」はすべてサーバー側で行う。
 * 客側に顧客台帳を読ませない・予約を任意に書き換えさせないための境界。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const accessToken = String(body.accessToken ?? body.reservationId ?? '').trim()

    return await withQuestionnaireWriteLock(async () => {
      const reservations = await store.getReservations()
      const reservation = reservations.find((r) => r.questionnaireToken === accessToken || (!r.questionnaireToken && r.id === accessToken))
      if (!reservation) {
        return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
      }

      if (!isValidDate(reservation.date)) {
        return NextResponse.json({ error: '予約日が不正です' }, { status: 500 })
      }

      const existingQuestionnaire = (await store.getQuestionnaires()).find((item) => item.reservationId === reservation.id)
      if (existingQuestionnaire) {
        if (!existingQuestionnaire.qrExpiresAt || new Date(existingQuestionnaire.qrExpiresAt).getTime() <= Date.now()) {
          return NextResponse.json({ error: 'MSG-18：ページが見つかりません。URLをご確認ください。' }, { status: 404 })
        }
        return NextResponse.json({
          ok: true,
          questionnaireId: existingQuestionnaire.id,
          qrToken: existingQuestionnaire.qrToken,
          qrIssuedAt: existingQuestionnaire.qrIssuedAt,
          qrExpiresAt: existingQuestionnaire.qrExpiresAt,
          lastName: existingQuestionnaire.lastName,
          firstName: existingQuestionnaire.firstName,
          lastNameKana: existingQuestionnaire.lastNameKana,
          firstNameKana: existingQuestionnaire.firstNameKana,
          reservationDate: reservation.date,
          course: reservation.course,
          alreadySubmitted: true,
        })
      }

      const questionnaireId = `Q-${randomUUID()}`
      const qrIssuedAt = new Date()
      const qData: QuestionnaireData = {
        ...body,
        id: questionnaireId,
        reservationId: reservation.id,
        submittedAt: qrIssuedAt.toISOString(),
        qrToken: randomBytes(32).toString('hex'),
        qrIssuedAt: qrIssuedAt.toISOString(),
        qrExpiresAt: qrExpiryFor(reservation.date).toISOString(),
        qrUsed: false,
      }
      await store.addQuestionnaire(qData)

      // 予約に問診票IDをリンク
      await store.updateReservation(reservation.id, { questionnaireId })

    // 顧客台帳に自動登録（氏名で重複チェック）
      const customers = await store.getCustomers()
      const fullName = `${qData.lastName} ${qData.firstName}`
      const existing = customers.find(
        (c) => `${c.lastName} ${c.firstName}` === fullName
      )
      const today = new Date().toISOString().slice(0, 10)

      if (!existing) {
      const newCustomer: Customer = {
        id: `C-${randomUUID()}`,
        lastName: qData.lastName,
        firstName: qData.firstName,
        lastNameKana: qData.lastNameKana,
        firstNameKana: qData.firstNameKana,
        phone: qData.phone,
        email: '',
        lastVisit: today,
        visitCount: 1,
        hasCCard: qData.hasCCard,
        cCardType: qData.cCardType,
        totalDives: qData.totalDives,
        healthNotes: [
          qData.heartDisease       && '心臓疾患',
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

      return NextResponse.json({
        ok: true,
        questionnaireId,
        qrToken: qData.qrToken,
        qrIssuedAt: qData.qrIssuedAt,
        qrExpiresAt: qData.qrExpiresAt,
        lastName: qData.lastName,
        firstName: qData.firstName,
        lastNameKana: qData.lastNameKana,
        firstNameKana: qData.firstNameKana,
        reservationDate: reservation.date,
        course: reservation.course,
      })
    })
  } catch (err) {
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
