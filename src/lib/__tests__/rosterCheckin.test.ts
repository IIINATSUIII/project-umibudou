import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Customer, QuestionnaireData, Reservation, RosterEntry } from '@/types'

const memory = vi.hoisted(() => ({
  questionnaires: [] as QuestionnaireData[],
  reservations: [] as Reservation[],
  customers: [] as Customer[],
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

import { POST } from '@/app/api/roster/route'

const qrToken = 'independent-reception-qr-token'

function request(method: 'QR読取' | '手動照合' = 'QR読取') {
  return new NextRequest('http://localhost/api/roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionnaireId: 'Q-1', qrToken, method }),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'))
  memory.questionnaires = [{
    id: 'Q-1',
    reservationId: 'R-1',
    customerId: 'C-1',
    lastName: '山田',
    firstName: '太郎',
    lastNameKana: 'ヤマダ',
    firstNameKana: 'タロウ',
    birthDate: '1990-10-07',
    gender: 'male',
    address: '沖縄県那覇市',
    phone: '090-1234-5678',
    emergencyName: '山田花子',
    emergencyRelation: '家族',
    emergencyPhone: '090-8765-4321',
    qrToken,
    qrExpiresAt: '2026-10-06T15:00:00.000Z',
    qrUsed: false,
  } as QuestionnaireData]
  memory.reservations = [{
    id: 'R-1', diveDate: '2026-10-06', status: 'STS-03', courseName: '体験ダイビング', staffName: 'スタッフ',
  } as Reservation]
  memory.customers = [{ id: 'C-1', phone: '090-1234-5678' } as Customer]
  memory.roster = []
  memory.getQuestionnaires.mockReset().mockImplementation(async () => memory.questionnaires)
  memory.getReservations.mockReset().mockImplementation(async () => memory.reservations)
  memory.getCustomers.mockReset().mockImplementation(async () => memory.customers)
  memory.getRoster.mockReset().mockImplementation(async () => memory.roster)
  memory.addRoster.mockReset().mockImplementation(async (entry: RosterEntry) => {
    memory.roster.push(entry)
    return entry
  })
  memory.updateQuestionnaire.mockReset().mockImplementation(async (id: string, delta: Partial<QuestionnaireData>) => {
    const questionnaire = memory.questionnaires.find((item) => item.id === id)!
    Object.assign(questionnaire, delta)
    return questionnaire
  })
})

afterEach(() => {
  vi.useRealTimers()
})

it('saves a roster entry from the opaque QR token and marks the QR as used', async () => {
  const response = await POST(request())

  expect(response.status).toBe(200)
  expect(memory.roster).toHaveLength(1)
  expect(memory.roster[0]).toMatchObject({
    reservationId: 'R-1',
    questionnaireId: 'Q-1',
    customerId: 'C-1',
    name: '山田 太郎',
    course: '体験ダイビング',
    checkInMethod: 'QR読取',
  })
  expect(memory.questionnaires[0].qrUsed).toBe(true)
  expect(memory.updateQuestionnaire).toHaveBeenCalledWith('Q-1', { qrUsed: true })
})

it.each([
  { qrUsed: true, expected: 'MSG-22' },
  { qrExpiresAt: '2026-10-05T15:00:00.000Z', expected: 'MSG-10' },
])('rejects an unusable QR without creating a roster entry: $expected', async ({ expected, ...delta }) => {
  Object.assign(memory.questionnaires[0], delta)

  const response = await POST(request())
  const body = await response.json()

  expect(response.ok).toBe(false)
  expect(body.error).toContain(expected)
  expect(memory.roster).toHaveLength(0)
  expect(memory.addRoster).not.toHaveBeenCalled()
})

it('rejects a QR token that does not match the questionnaire', async () => {
  const invalidRequest = new NextRequest('http://localhost/api/roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionnaireId: 'Q-1', qrToken: 'wrong-token', method: 'QR読取' }),
  })

  const response = await POST(invalidRequest)

  expect(response.status).toBe(400)
  expect(memory.roster).toHaveLength(0)
  expect(memory.addRoster).not.toHaveBeenCalled()
})
