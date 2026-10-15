import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Customer } from '@/types'

const mock = vi.hoisted(() => ({ getCustomers: vi.fn(), updateCustomer: vi.fn() }))
vi.mock('@/lib/dataStore', () => ({
  store: { getCustomers: mock.getCustomers, updateCustomer: mock.updateCustomer },
}))
vi.mock('@/lib/storeLock', () => ({
  withStoreWriteLock: async (work: () => Promise<unknown>) => work(),
  StoreBusyError: class StoreBusyError extends Error {},
}))

import { PATCH } from '@/app/api/customers/route'
import { DataStoreConflictError } from '../dataStoreErrors'

vi.mock('@/lib/staffAuth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/staffAuth')>('@/lib/staffAuth')
  return {
    ...actual,
    requireStaffSession: vi.fn().mockResolvedValue({ ok: true, session: { email: 'staff@example.com' } }),
  }
})



const customer: Customer = {
  id: 'C-1', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ',
  phone: '090-1234-5678', email: 'taro@example.com', lastVisit: '2026-10-01', visitCount: 1,
  hasCCard: false, cCardType: '', totalDives: 0, healthNotes: '', guideNotes: '', updatedAt: 'v1',
}

afterEach(() => vi.resetAllMocks())

it('returns 409 when the customer row changes after the route read it', async () => {
  mock.getCustomers
    .mockResolvedValueOnce([customer])
    .mockResolvedValueOnce([{ ...customer, lastName: '佐藤', updatedAt: 'v2' }])
  mock.updateCustomer.mockRejectedValue(new DataStoreConflictError())
  const request = new NextRequest('http://localhost/api/customers', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'C-1', expectedUpdatedAt: 'v1', lastName: '鈴木' }),
  })

  const response = await PATCH(request)

  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ error: 'CONFLICT', customer: { lastName: '佐藤', updatedAt: 'v2' } })
  expect(mock.updateCustomer).toHaveBeenCalledWith(
    'C-1', expect.objectContaining({ lastName: '鈴木' }), 'v1'
  )
})
