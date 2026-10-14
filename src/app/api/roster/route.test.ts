import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { QuestionnaireData, Reservation, RosterEntry } from '@/types'

const memory = vi.hoisted(() => ({
  questionnaire: {} as QuestionnaireData,
  reservation: {} as Reservation,
  roster: [] as RosterEntry[],
  getQuestionnaires: vi.fn(),
  getReservations: vi.fn(),
  getCustomers: vi.fn(),
  getRoster: vi.fn(),
  addRoster: vi.fn(),
  updateQuestionnaire: vi.fn(),
}))

vi.mock('@/lib/dataStore', () => ({
  store: {
    getQuestionnaires: memory.getQuestionnaires,
    getReservations: memory.getReservations,
    getCustomers: memory.getCustomers,
    getRoster: memory.getRoster,
    addRoster: memory.addRoster,
    updateQuestionnaire: memory.updateQuestionnaire,
  },
}))
vi.mock('@/lib/storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => work(),
}))

import { POST } from './route'

const qrToken = 'fresh-questionnaire-qr-token-1234567890'
const request = (method: 'QR読取' | '手動照合') => new NextRequest('http://localhost/api/roster', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ questionnaireId: 'M-0001', method, qrToken }),
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T01:00:00.000Z'))
  memory.questionnaire = {
    id: 'M-0001',
    reservationId: 'R-0001',
    qrToken,
    qrExpiresAt: '2026-10-07T00:00:00.000Z',
    qrUsed: false,
    lastName: '山田',
    firstName: '太郎',
    lastNameKana: 'ヤマダ',
    firstNameKana: 'タロウ',
    birthDate: '1990-01-01',
    phone: '090-1234-5678',
    emergencyName: '山田 花子',
    emergencyRelation: '家族',
    emergencyPhone: '090-9876-5432',
    address: '沖縄県那覇市',
  } as QuestionnaireData
  memory.reservation = {
    id: 'R-0001',
    status: 'STS-03',
    diveDate: '2026-10-06',
    courseName: '体験ダイビング',
  } as Reservation
  memory.roster = []
  memory.getQuestionnaires.mockReset().mockImplementation(async () => [memory.questionnaire])
  memory.getReservations.mockReset().mockImplementation(async () => [memory.reservation])
  memory.getCustomers.mockReset().mockResolvedValue([])
  memory.getRoster.mockReset().mockImplementation(async () => memory.roster)
  memory.addRoster.mockReset().mockImplementation(async (entry: RosterEntry) => entry)
  memory.updateQuestionnaire.mockReset().mockImplementation(async (_id: string, delta: Partial<QuestionnaireData>) => Object.assign(memory.questionnaire, delta))
})

afterEach(() => vi.useRealTimers())

it.each(['QR読取', '手動照合'] as const)('rejects %s check-in when the reservation is not today', async (method) => {
  memory.reservation = { ...memory.reservation, diveDate: '2026-10-07' }

  const response = await POST(request(method))

  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ error: expect.stringContaining('本日の予約') })
  expect(memory.addRoster).not.toHaveBeenCalled()
})

it('allows check-in for a reservation scheduled today', async () => {
  const response = await POST(request('QR読取'))

  expect(response.status).toBe(200)
  expect(memory.addRoster).toHaveBeenCalledTimes(1)
})
