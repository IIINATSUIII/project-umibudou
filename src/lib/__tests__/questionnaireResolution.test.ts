import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Customer, QuestionnaireData } from '@/types'

const memory = vi.hoisted(() => ({
  questionnaires: [] as QuestionnaireData[],
  customers: [] as Customer[],
  lockDepth: 0,
  lockCalls: 0,
  failCustomerUpdateAfterWrite: false,
}))

vi.mock('@/lib/dataStore', () => ({
  USE_POSTGRES: false,
  store: {
    getQuestionnaires: async () => {
      if (!memory.lockDepth) throw new Error('questionnaire read escaped the shared write lock')
      return structuredClone(memory.questionnaires)
    },
    getCustomers: async () => {
      if (!memory.lockDepth) throw new Error('customer read escaped the shared write lock')
      return structuredClone(memory.customers)
    },
    updateQuestionnaire: async (id: string, delta: Partial<QuestionnaireData>) => {
      if (!memory.lockDepth) throw new Error('questionnaire update escaped the shared write lock')
      const questionnaire = memory.questionnaires.find((item) => item.id === id)!
      Object.assign(questionnaire, delta)
      return structuredClone(questionnaire)
    },
    updateCustomer: async (id: string, delta: Partial<Customer>) => {
      if (!memory.lockDepth) throw new Error('customer update escaped the shared write lock')
      const customer = memory.customers.find((item) => item.id === id)!
      Object.assign(customer, delta)
      if (memory.failCustomerUpdateAfterWrite) {
        memory.failCustomerUpdateAfterWrite = false
        throw new Error('response lost after customer update')
      }
    },
  },
}))

vi.mock('@/lib/storeLock', () => ({
  withStoreWriteLock: async <T>(work: () => Promise<T>) => {
    memory.lockCalls += 1
    memory.lockDepth += 1
    try {
      return await work()
    } finally {
      memory.lockDepth -= 1
    }
  },
  StoreBusyError: class StoreBusyError extends Error {},
}))

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'odp_session',
  verifySessionToken: async (token: string) => token === 'staff-session' ? { email: 'staff@example.com' } : null,
}))

import { PATCH } from '@/app/api/questionnaires/route'

const questionnaire = () => ({
  id: 'Q-1', reservationId: 'R-1', submittedAt: '2026-10-01T00:00:00.000Z',
  lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ',
  birthDate: '1990-01-01', gender: 'male', postalCode: '9000001', address: '沖縄県那覇市',
  phone: '09012345678', email: 'taro@example.com', emergencyName: '山田花子',
  emergencyRelation: '家族', emergencyPhone: '09087654321', heartDisease: true,
  medication: false, medicationName: '', hasCCard: false, cCardType: '未取得',
  cCardOrg: '', totalDives: 3, lastDiveDate: '初めて', staffReviewStatus: '要対応',
} as QuestionnaireData)

const customer = (id: string) => ({
  id, lastName: '旧姓', firstName: '旧名', lastNameKana: 'キュウセイ', firstNameKana: 'キュウメイ',
  phone: '08000000000', email: 'old@example.com', lastVisit: '', visitCount: 0,
  hasCCard: false, cCardType: '', totalDives: 0, healthNotes: '', guideNotes: '',
  countedReservationIds: '[]',
} as Customer)

const call = (customerId: string) => PATCH(new NextRequest('http://localhost/api/questionnaires', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', cookie: 'odp_session=staff-session' },
  body: JSON.stringify({ questionnaireId: 'Q-1', customerId }),
}))

beforeEach(() => {
  memory.questionnaires = [questionnaire()]
  memory.customers = [customer('C-1'), customer('C-2')]
  memory.lockDepth = 0
  memory.lockCalls = 0
  memory.failCustomerUpdateAfterWrite = false
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

it('keeps questionnaire/customer reads and all resolution writes inside the shared lock', async () => {
  const [first, second] = await Promise.all([call('C-1'), call('C-2')])
  const statuses = [first.status, second.status].sort()

  expect(statuses).toEqual([200, 409])
  expect(memory.lockCalls).toBe(2)
  expect(memory.questionnaires[0].customerId).toBe('C-1')
  expect(memory.questionnaires[0].staffReviewStatus).toBe('確認済')
  expect(memory.customers.map((item) => item.visitCount)).toEqual([1, 0])
  expect(memory.customers[0].healthNotes).toBe('心臓疾患')
})

it('retries after a lost response without double-counting the reservation', async () => {
  memory.failCustomerUpdateAfterWrite = true

  expect((await call('C-1')).status).toBe(500)
  expect((await call('C-1')).status).toBe(200)
  expect(memory.customers[0].visitCount).toBe(1)
  expect(JSON.parse(memory.customers[0].countedReservationIds ?? '[]')).toEqual(['R-1'])
  expect(memory.questionnaires[0].staffReviewStatus).toBe('確認済')
})
