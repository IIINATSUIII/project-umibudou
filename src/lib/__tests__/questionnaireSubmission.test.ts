import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import type { QuestionnaireData, Reservation, Customer } from '@/types'

const memory = vi.hoisted(() => ({
  qs: [] as QuestionnaireData[], customers: [] as Customer[], reservations: [] as Reservation[],
  fail: '', afterWrite: false,
}))
vi.mock('@/lib/dataStore', () => {
  const write = async (name: string, action: () => void) => {
    const fail = memory.fail === name
    if (fail) memory.fail = ''
    if (fail && !memory.afterWrite) throw new Error('injected failure')
    action()
    if (fail) throw new Error('response lost after persistence')
  }
  return { store: {
    getQuestionnaires: async () => structuredClone(memory.qs),
    getCustomers: async () => structuredClone(memory.customers),
    getReservations: async () => structuredClone(memory.reservations),
    addQuestionnaire: async (q: QuestionnaireData) => write('addQuestionnaire', () => memory.qs.push(structuredClone(q))),
    addCustomer: async (c: Customer) => write('addCustomer', () => memory.customers.push(structuredClone(c))),
    updateCustomer: async (id: string, delta: Partial<Customer>) => write('updateCustomer', () => Object.assign(memory.customers.find(c => c.id === id)!, delta)),
    updateQuestionnaire: async (id: string, delta: Partial<QuestionnaireData>) => write(delta.submissionState ? 'complete' : 'linkQuestionnaire', () => Object.assign(memory.qs.find(q => q.id === id)!, delta)),
    updateReservation: async (id: string, delta: Partial<Reservation>) => write('linkReservation', () => Object.assign(memory.reservations.find(r => r.id === id)!, delta)),
  } }
})
import { saveSubmission, validateSubmission } from '../questionnaireSubmission'

export const validAnswers = {
  lastName:'山田',firstName:'太郎',lastNameKana:'ヤマダ',firstNameKana:'タロウ',
  birthDate:'1990-01-01',gender:'unanswered',postalCode:'9000001',address:'沖縄県那覇市',
  phone:'09012345678',email:'taro@example.com',emergencyName:'山田花子',emergencyRelation:'家族',emergencyPhone:'09087654321',
  heartDisease:false,hypertension:false,respiratoryDisease:false,earDisease:false,epilepsy:false,diabetes:false,
  pregnant:false,panicDisorder:false,latexAllergy:false,medication:false,medicationName:'',medicalCertificate:false,
  sleepCategory:'6時間以上',alcoholLastNight:false,alcoholToday:false,condition:'good',conditionDetails:'',flightWithin48h:false,
  hasCCard:false,cCardType:'未取得',cCardOrg:'',lastDivePeriod:'初めて',totalDives:null,
  agreeRisk:true,agreeMedical:true,agreePhoto:false,
}
let directory: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odp-submission-test-'))
  vi.stubEnv('LOCAL_DATA_DIR', directory)
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '')
  memory.qs=[];memory.customers=[];memory.reservations=[{id:'R-1',diveDate:'2026-10-06'} as Reservation]
  memory.fail='';memory.afterWrite=false
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory,{recursive:true,force:true}) })

it('写真不可を受理し、未選択や文字列trueを拒否する', () => {
  expect(validateSubmission(validAnswers)).toEqual({})
  for(const agreePhoto of [undefined,null,'false']) expect(validateSubmission({...validAnswers,agreePhoto})).toHaveProperty('agreePhoto')
  expect(validateSubmission({...validAnswers,agreeRisk:false})).toHaveProperty('agreeRisk')
})
for(const afterWrite of [false,true]) {
  it.each(['addQuestionnaire','addCustomer','linkQuestionnaire','linkReservation','complete'])('保存失敗 %s 後の再送で不足処理を完了する '+afterWrite, async fail => {
    memory.fail=fail;memory.afterWrite=afterWrite
    await expect(saveSubmission(memory.reservations[0],validAnswers)).rejects.toThrow()
    const q = await saveSubmission(memory.reservations[0],validAnswers)
    await saveSubmission(memory.reservations[0],validAnswers)
    expect(memory.qs).toHaveLength(1)
    expect(memory.customers).toHaveLength(1)
    expect(memory.customers[0]).toMatchObject({visitCount:1,totalDives:null})
    expect(JSON.parse(memory.customers[0].countedQuestionnaireIds!)).toEqual([q.id])
    expect(memory.reservations[0]).toMatchObject({questionnaireCompleted:true,questionnaireId:q.id,customerId:q.customerId})
    expect(memory.qs[0].submissionState).toBe('complete')
  })
}
it('同一連絡先の別予約を同時提出しても顧客を二重作成しない', async () => {
  const second={id:'R-2',diveDate:'2026-10-06'} as Reservation
  memory.reservations.push(second)
  const qs=await Promise.all([saveSubmission(memory.reservations[0],validAnswers),saveSubmission(second,validAnswers)])
  expect(memory.customers).toHaveLength(1)
  expect(memory.customers[0].visitCount).toBe(2)
  expect(qs[0].customerId).toBe(qs[1].customerId)
})
it('旧回答のID・健康情報・同意を保持して欠落する受付QRを補完する', async () => {
  const first=await saveSubmission(memory.reservations[0],validAnswers)
  memory.qs[0].qrToken=undefined;memory.qs[0].qrExpiresAt=undefined
  const restored=await saveSubmission(memory.reservations[0],validAnswers)
  expect(restored).toMatchObject({id:first.id,customerId:first.customerId,agreePhoto:false})
  expect(restored.qrToken).toBeTruthy()
  expect(Number.isFinite(Date.parse(restored.qrExpiresAt!))).toBe(true)
  expect(memory.customers[0].visitCount).toBe(1)
})
it.each([false,true])('既存顧客の加算失敗も再開して一回だけ加算する %s', async afterWrite => {
  const first=await saveSubmission(memory.reservations[0],validAnswers)
  const second={id:'R-2',diveDate:'2026-10-06'} as Reservation
  memory.reservations.push(second);memory.fail='updateCustomer';memory.afterWrite=afterWrite
  await expect(saveSubmission(second,validAnswers)).rejects.toThrow()
  await saveSubmission(second,validAnswers)
  expect(memory.customers).toHaveLength(1)
  expect(memory.customers[0].visitCount).toBe(2)
  expect(memory.qs[1].customerId).toBe(first.customerId)
})
