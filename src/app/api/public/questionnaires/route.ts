import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { store } from '@/lib/dataStore'
import type { Customer, QuestionnaireData } from '@/types'
import { validateQuestionnaireInput } from '@/lib/questionnaireValidation'

let questionnaireWriteLock = Promise.resolve()

async function withQuestionnaireWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = questionnaireWriteLock
  let release!: () => void
  questionnaireWriteLock = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await work() } finally { release() }
}

function accessTokenFrom(body: Record<string, unknown>): string {
  return String(body.accessToken ?? body.reservationId ?? '').trim()
}

async function findReservation(accessToken: string) {
  if (!accessToken || accessToken.length > 200) return undefined
  const reservations = await store.getReservations()
  // 旧予約との互換性のためIDも許可する。新規URLは常にquestionnaireTokenを使う。
  return reservations.find((reservation) => reservation.questionnaireToken === accessToken || (!reservation.questionnaireToken && reservation.id === accessToken))
}

/** POST /api/public/questionnaires — 問診票提出（ログイン不要） */
export async function POST(req: NextRequest) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON形式の入力データが不正です' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '入力データが不正です' }, { status: 400 })
    }
    const payload = body as Record<string, unknown>
    const accessToken = accessTokenFrom(payload)

    return await withQuestionnaireWriteLock(async () => {
      const reservation = await findReservation(accessToken)
      if (!reservation) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })

      const existing = (await store.getQuestionnaires()).find((item) => item.reservationId === reservation.id)
      if (existing) return NextResponse.json({ ok: true, questionnaireId: existing.id, alreadySubmitted: true })

      const validation = validateQuestionnaireInput(payload)
      if (!validation.ok) return NextResponse.json({ error: '入力内容を確認してください', fields: validation.errors }, { status: 400 })

      const questionnaireId = `Q-${randomUUID()}`
      const qData: QuestionnaireData = {
        ...validation.data,
        id: questionnaireId,
        reservationId: reservation.id,
        submittedAt: new Date().toISOString(),
      }
      await store.addQuestionnaire(qData)
      await store.updateReservation(reservation.id, { questionnaireId })

      const customers = await store.getCustomers()
      const fullName = `${qData.lastName} ${qData.firstName}`
      const existingCustomer = customers.find((customer) => `${customer.lastName} ${customer.firstName}` === fullName)
      const today = new Date().toISOString().slice(0, 10)
      if (!existingCustomer) {
        const newCustomer: Customer = {
          id: `C-${randomUUID()}`, lastName: qData.lastName, firstName: qData.firstName,
          lastNameKana: qData.lastNameKana, firstNameKana: qData.firstNameKana,
          phone: qData.phone, email: '', lastVisit: today, visitCount: 1,
          hasCCard: qData.hasCCard, cCardType: qData.cCardType, totalDives: qData.totalDives,
          healthNotes: [qData.heartDisease && '心臓疾患', qData.respiratoryDisease && '呼吸器疾患', qData.earDisease && '耳の疾患', qData.epilepsy && 'てんかん', qData.diabetes && '糖尿病', qData.medication && `服薬：${qData.medicationName}`, qData.latexAllergy && 'ラテックスアレルギー'].filter(Boolean).join('、') || '特記なし',
          guideNotes: '',
        }
        await store.addCustomer(newCustomer)
      } else {
        await store.updateCustomer(existingCustomer.id, { visitCount: existingCustomer.visitCount + 1, lastVisit: today })
      }

      return NextResponse.json({ ok: true, questionnaireId })
    })
  } catch (err) {
    console.error('[POST /api/public/questionnaires]', err)
    return NextResponse.json({ error: 'Failed to save questionnaire' }, { status: 500 })
  }
}
