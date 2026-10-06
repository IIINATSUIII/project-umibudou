import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/dataStore'
import { createToken, getQuestionnaireExpiry, withQuestionnaireLock } from '@/lib/questionnaireToken'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return withQuestionnaireLock(async () => {
    try {
      const reservations = await store.getReservations()
      const reservation = reservations.find((r) => r.id === params.id)
      if (!reservation) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
      const expiresAt = getQuestionnaireExpiry(reservation.date)
      if (reservation.status === 'cancelled' || Date.parse(expiresAt) <= Date.now()) return NextResponse.json({ error: '期限切れ・キャンセル済みの予約には発行できません' }, { status: 409 })
      const accessToken = createToken()
      await store.updateReservation(reservation.id, { questionnaireToken: accessToken, questionnaireExpiresAt: expiresAt })
      return NextResponse.json({ accessToken, expiresAt, url: new URL(`/questionnaire/${accessToken}`, req.nextUrl.origin).toString() }, { headers: { 'Cache-Control': 'no-store' } })
    } catch {
      return NextResponse.json({ error: '問診URLを発行できませんでした' }, { status: 500 })
    }
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return withQuestionnaireLock(async () => {
    try {
      if (!(await store.getReservations()).some((r) => r.id === params.id)) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 })
      await store.updateReservation(params.id, { questionnaireToken: '', questionnaireExpiresAt: '' })
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: '問診URLを無効化できませんでした' }, { status: 500 })
    }
  })
}
