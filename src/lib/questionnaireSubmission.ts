import { nextUpdatedAt } from './updateVersion'
import { randomUUID } from 'crypto'
import { store } from './dataStore'
import { withStoreWriteLock } from './storeLock'
import { HEADERS } from './storeSchema'
import { validateQuestionnaire } from './questionnaireValidation'
import {
  validateQuestionnaireExperience,
  normalizeQuestionnaireExperience,
} from './questionnaireExperience'
import {
  findExistingCustomer,
  buildNewCustomer,
  buildCustomerUpdate,
  nextCustomerId,
  type CustomerSource,
} from './customerRegistration'
import { getQuestionnaireExpiry, generateQrToken } from './questionnaireToken'
import type { QuestionnaireData, Reservation, Customer } from '@/types'

export function validateSubmission(value: unknown): Record<string, string> {
  const errors = {
    ...validateQuestionnaire(value),
    ...validateQuestionnaireExperience(value),
  }
  const data =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  if (data.agreeRisk !== true) errors.agreeRisk = 'リスクへの同意が必要です'
  if (data.agreeMedical !== true)
    errors.agreeMedical = '医療処置への同意が必要です'
  if (typeof data.agreePhoto !== 'boolean')
    errors.agreePhoto = '写真利用の可否を選択してください'
  return errors
}
export class SubmissionValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('入力内容を確認してください')
  }
}
function countedIds(c: Customer): string[] {
  const ids: unknown = JSON.parse(c.countedQuestionnaireIds || '[]')
  if (!Array.isArray(ids) || ids.some((v) => typeof v !== 'string'))
    throw new Error('顧客の処理済み問診IDが不正です')
  return ids
}

/** 問診の保存済みスナップショットから不足する処理を再開する。来店加算と処理済みIDは同時保存。 */
export async function saveSubmission(
  reservation: Reservation,
  input: Record<string, unknown>
): Promise<QuestionnaireData> {
  return withStoreWriteLock(async () => {
    const all = await store.getQuestionnaires()
    const existingQ = all.find((q) => q.reservationId === reservation.id)
    if (!existingQ) {
      const fields = validateSubmission(input)
      if (Object.keys(fields).length)
        throw new SubmissionValidationError(fields)
    }
    let customers = await store.getCustomers()
    let q = existingQ
    if (!q) {
      const answers = normalizeQuestionnaireExperience(input)
      const source = answers as unknown as CustomerSource
      const customer = findExistingCustomer(customers, source)
      const submittedAt = new Date().toISOString()
      const automatic = [
        'id',
        'reservationId',
        'submittedAt',
        'customerId',
        'consentAt',
        'qrToken',
        'qrIssuedAt',
        'qrExpiresAt',
        'qrUsed',
        'doctorClearance',
        'staffCheckStatus',
        'staffCheckNote',
        'submissionState',
      ]
      const values = Object.fromEntries(
        HEADERS.QUESTIONNAIRES.filter((h) => !automatic.includes(h)).map(
          (h) => [h, answers[h]]
        )
      )
      q = {
        ...values,
        id: `M-${randomUUID()}`,
        reservationId: reservation.id,
        submittedAt,
        customerId: customer?.id || nextCustomerId(customers),
        consentAt: submittedAt,
        qrToken: generateQrToken(),
        qrIssuedAt: submittedAt,
        qrExpiresAt: getQuestionnaireExpiry(reservation.diveDate),
        qrUsed: false,
        doctorClearance: '',
        staffCheckStatus: '未確認',
        staffCheckNote: '',
        submissionState: 'pending',
      } as unknown as QuestionnaireData
      await store.addQuestionnaire(q)
    }
    // 元37列や途中保存の回答にも受付トークンを発行する。回答・問診IDは変更しない。
    if (!q.qrToken || !Number.isFinite(Date.parse(q.qrExpiresAt || ''))) {
      const qr = {
        qrToken: q.qrToken || generateQrToken(),
        qrIssuedAt: q.qrIssuedAt || new Date().toISOString(),
        qrExpiresAt: getQuestionnaireExpiry(reservation.diveDate),
      }
      await store.updateQuestionnaire(q.id, qr)
      q = { ...q, ...qr }
    }
    const source = q as CustomerSource
    const customer =
      customers.find((c) => c.id === q!.customerId) ??
      findExistingCustomer(customers, source)
    const now = new Date(q.submittedAt)
    if (!customer) {
      const newCustomer = buildNewCustomer(
        source,
        q.customerId || nextCustomerId(customers),
        now
      )
      newCustomer.postalCode = q.postalCode
      newCustomer.lastDivePeriod = q.lastDivePeriod
      newCustomer.countedQuestionnaireIds = JSON.stringify([q.id])
      await store.addCustomer(newCustomer)
      q = { ...q, customerId: newCustomer.id }
    } else {
      const ids = countedIds(customer)
      if (!ids.includes(q.id)) {
        await store.updateCustomer(customer.id, {
          ...buildCustomerUpdate(source, customer, now),
          postalCode: customer.postalCode || q.postalCode,
          lastDivePeriod: q.lastDivePeriod,
          countedQuestionnaireIds: JSON.stringify([...ids, q.id]),
        })
      }
      q = { ...q, customerId: customer.id }
    }
    await store.updateQuestionnaire(q.id, { customerId: q.customerId })
    await store.updateReservation(reservation.id, {
      customerId: q.customerId,
      questionnaireId: q.id,
      questionnaireCompleted: true,
      updatedAt: nextUpdatedAt(reservation.updatedAt),
    })
    // 成功応答の前に両関連保存と処理済みIDを確認する。
    customers = await store.getCustomers()
    const savedCustomer = customers.find((c) => c.id === q!.customerId)
    const savedReservation = (await store.getReservations()).find(
      (r) => r.id === reservation.id
    )
    if (
      !savedCustomer ||
      !countedIds(savedCustomer).includes(q.id) ||
      savedReservation?.questionnaireId !== q.id ||
      savedReservation.customerId !== q.customerId
    )
      throw new Error('関連保存が未完了です')
    await store.updateQuestionnaire(q.id, { submissionState: 'complete' })
    return { ...q, submissionState: 'complete' }
  })
}
