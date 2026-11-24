import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mock = vi.hoisted(() => ({
  getReservations: vi.fn(),
  patchReservation: vi.fn(),
  ConflictError: class ReservationConflictError extends Error {},
}))

vi.mock('@/lib/dataStore', () => ({ store: { getReservations: mock.getReservations } }))
vi.mock('@/lib/reservations', () => ({
  patchReservation: mock.patchReservation,
  ReservationConflictError: mock.ConflictError,
}))

import { POST } from '@/app/api/public/cancellation-requests/route'
import type { Reservation } from '@/types'

const TOKEN = 'guest-reservation-token-with-128-bits-or-more'

const reservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  id: 'R-1',
  updatedAt: '2026-12-01T00:00:00.000Z',
  guestName: '山田 太郎',
  guestPhone: '090-1234-5678',
  diveDate: '2026-12-10',
  timeSlot: 'morning',
  courseName: '体験ダイビング',
  guestCount: 2,
  status: 'STS-03',
  channel: 'hp',
  questionnaireToken: TOKEN,
  questionnaireTokenExpiresAt: '2026-12-10T14:59:59.999Z',
  ...overrides,
})

const call = (body: unknown) => POST(new NextRequest('http://localhost/api/public/cancellation-requests', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))

const request = (overrides: Record<string, unknown> = {}) =>
  call({ action: 'request', reservationId: 'R-1', reservationToken: TOKEN, ...overrides })

describe('POST /api/public/cancellation-requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-12-01T03:00:00.000Z'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mock.getReservations.mockReset().mockResolvedValue([reservation()])
    mock.patchReservation.mockReset().mockResolvedValue('2026-12-01T03:00:00.001Z')
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('申請を保存しても予約ステータスは変えない', async () => {
    const response = await request({ note: ' 体調不良 ' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      ok: true, alreadyRequested: false, request: { status: 'pending' }, reservation: { state: 'confirmed' },
    })
    expect(mock.patchReservation).toHaveBeenCalledWith('R-1', {
      cancellationRequestStatus: 'pending',
      cancellationRequestedAt: '2026-12-01T03:00:00.000Z',
      cancellationRequestNote: '体調不良',
    }, '2026-12-01T00:00:00.000Z')
    const delta = mock.patchReservation.mock.calls[0][1]
    expect(delta).not.toHaveProperty('status')
  })

  it('状況確認では保存せず、個人情報を返さない', async () => {
    const response = await call({ action: 'status', reservationId: 'R-1', reservationToken: TOKEN })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('山田')
    expect(text).not.toContain('090-1234-5678')
    expect(text).not.toContain(TOKEN)
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it('申請中の予約への再送は既存の申請を返し、重複して保存しない', async () => {
    mock.getReservations.mockResolvedValue([reservation({
      cancellationRequestStatus: 'pending', cancellationRequestedAt: '2026-11-30T00:00:00.000Z',
    })])
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, alreadyRequested: true, request: { requestedAt: '2026-11-30T00:00:00.000Z' } })
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it('同時送信で競合したら最新の申請を返す', async () => {
    mock.getReservations
      .mockResolvedValueOnce([reservation()])
      .mockResolvedValueOnce([reservation({ cancellationRequestStatus: 'pending', updatedAt: '2026-12-01T03:00:00.001Z' })])
    mock.patchReservation.mockRejectedValue(new mock.ConflictError('conflict'))
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, alreadyRequested: true })
  })

  it.each([
    ['別の予約番号', { reservationId: 'R-2' }],
    ['違う確認コード', { reservationToken: 'x'.repeat(TOKEN.length) }],
  ])('%sは理由を区別しない同じエラーにする', async (_label, overrides) => {
    mock.getReservations.mockResolvedValue([reservation(), reservation({ id: 'R-2', questionnaireToken: 'other-token-with-enough-length-0000' })])
    const response = await request(overrides)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: '予約を確認できませんでした。予約番号と確認コードをご確認ください。' })
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it('失効した確認コードでは申請できない', async () => {
    mock.getReservations.mockResolvedValue([reservation({ questionnaireToken: '', questionnaireTokenExpiresAt: '' })])
    expect((await request()).status).toBe(404)
    mock.getReservations.mockResolvedValue([reservation({ questionnaireTokenExpiresAt: '2026-11-30T00:00:00.000Z' })])
    expect((await request()).status).toBe(404)
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it.each([
    ['締切後', reservation({ diveDate: '2026-12-01', questionnaireTokenExpiresAt: '2026-12-01T14:59:59.999Z' }), 'past_deadline'],
    ['キャンセル済み', reservation({ status: 'STS-04' }), 'already_cancelled'],
    ['却下済み', reservation({ cancellationRequestStatus: 'rejected' }), 'rejected'],
  ])('%sの予約は409で理由と案内を返す', async (_label, current, reason) => {
    mock.getReservations.mockResolvedValue([current])
    const response = await request()
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.reason).toBe(reason)
    expect(typeof body.error).toBe('string')
    expect(mock.patchReservation).not.toHaveBeenCalled()
  })

  it.each([
    ['不正なaction', { action: 'cancel' }],
    ['長すぎる理由', { note: 'あ'.repeat(201) }],
    ['短すぎる確認コード', { reservationToken: 'short' }],
  ])('%sは400', async (_label, overrides) => {
    expect((await request(overrides)).status).toBe(400)
    expect(mock.getReservations).not.toHaveBeenCalled()
  })

  it('保存に失敗したら、キャンセルが成立していないことを伝える', async () => {
    mock.patchReservation.mockRejectedValue(new Error('private-store-detail'))
    const response = await request()
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).toContain('キャンセルは成立していません')
    expect(text).not.toContain('private-store-detail')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-store-detail')
  })
})
