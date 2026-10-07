import { it, expect, vi, beforeEach } from 'vitest'
import { HEADERS, LEGACY_RESERVATION_HEADERS, LEGACY_QUESTIONNAIRE_HEADERS, assertQuestionnaireAliases, normalizeQuestionnaireForMigration } from '../storeSchema'
const mock=vi.hoisted(()=>({values:{} as Record<string,string[][]>,requests:[] as unknown[],backupCount:0}))
vi.mock('googleapis',()=>({google:{
  auth:{GoogleAuth:class {}},
  sheets:()=>({spreadsheets:{
    get:async()=>({data:{sheets:['予約','問診票','顧客台帳','名簿'].map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1000,columnCount:70}}}))}}),
    values:{
      get:async({range}:{range:string})=>({data:{values:mock.values[range.slice(1,-1)]}}),
      append:vi.fn(),
      batchUpdate:async(args:unknown)=>{mock.requests.push(args)},
    },
    batchUpdate:async({requestBody}:{requestBody:{requests:Array<{duplicateSheet?:unknown;updateCells?:{range:{sheetId:number};rows:Array<{values:Array<{userEnteredValue:{stringValue:string}}>}>}}>}})=>{
      for(const request of requestBody.requests) {
        mock.requests.push(request)
        if(request.duplicateSheet) mock.backupCount++
        if(request.updateCells) {
          const name=['予約','問診票','顧客台帳','名簿'][request.updateCells.range.sheetId]
          mock.values[name]=request.updateCells.rows.map(r=>r.values.map(v=>v.userEnteredValue.stringValue))
        }
      }
      return {data:{}}
    },
  }}),
}}))
vi.mock('../storeLock',()=>({withStoreWriteLock:async(work:()=>Promise<unknown>)=>work()}))
import { HEADERS as SHEET_HEADERS, getReservations, getQuestionnaires, updateReservation, initializeSheets } from '../sheets'

beforeEach(()=>{
  mock.requests=[];mock.backupCount=0
  mock.values={
    '予約':[LEGACY_RESERVATION_HEADERS,['R-7','2026-10-06','14:30','体験ダイビング','山田太郎','2','09012345678','phone','confirmed','M-7','送迎']],
    '問診票':[[...LEGACY_QUESTIONNAIRE_HEADERS,'postalCode','email','hypertension','medicalCertificate'],
      [...LEGACY_QUESTIONNAIRE_HEADERS.map(h=>({id:'M-7',reservationId:'R-7',lastName:'山田',firstName:'太郎',heartDisease:'TRUE',agreeRisk:'TRUE',agreeMedical:'TRUE',agreePhoto:'FALSE',sleepHours:'6',totalDives:'0'} as Record<string,string>)[h] || ''),'9000001','taro@example.com','TRUE','FALSE']],
    '顧客台帳':[HEADERS.CUSTOMERS], '名簿':[HEADERS.ROSTER],
  }
})
it('旧シートの読み取りは列名を使い、移行前の書き込みを止める',async()=>{
  expect((await getReservations())[0]).toMatchObject({id:'R-7',diveDate:'2026-10-06',guestPhone:'09012345678',questionnaireId:'M-7'})
  await expect(updateReservation('R-7',{status:'STS-04'})).rejects.toThrow('旧スキーマ')
  expect(mock.requests).toEqual([])
})
it('旧11列・37列をバックアップし、健康情報とAL以降の追加項目を保持する',async()=>{
  const result=await initializeSheets()
  expect(mock.backupCount).toBe(2)
  expect(result.filter(r=>r.status==='migrated')).toHaveLength(2)
  expect((await getReservations())[0]).toMatchObject({id:'R-7',diveDate:'2026-10-06',legacyTime:'14:30',guestCount:2,staffNote:'送迎'})
  expect((await getQuestionnaires())[0]).toMatchObject({id:'M-7',heartDisease:true,agreeRisk:true,agreePhoto:false,postalCode:'9000001',email:'taro@example.com',hypertension:true,medicalCertificate:false})
  const before=structuredClone(mock.values)
  await initializeSheets()
  expect(mock.values).toEqual(before)
  expect(mock.backupCount).toBe(2)
})
it('未知の列順でも現在のヘッダー位置に変更セルだけを書き込む',async()=>{
  await initializeSheets()
  const rows=mock.values['予約'];const headers=rows[0].slice().reverse()
  mock.values['予約']=[headers,headers.map(h=>rows[1][rows[0].indexOf(h)])]
  mock.requests=[]
  await updateReservation('R-7',{status:'STS-04'})
  expect(mock.requests).toHaveLength(1)
  const update=mock.requests[0] as {requestBody:{data:Array<{values:string[][]}>}}
  expect(update.requestBody.data).toHaveLength(1)
  expect(update.requestBody.data[0].values).toEqual([['STS-04']])
})
it('重複ヘッダーでは既存データに触れず中止する',async()=>{
  mock.values['予約'][0]=[...LEGACY_RESERVATION_HEADERS,'date']
  await expect(initializeSheets()).rejects.toThrow('重複')
  expect(mock.requests).toEqual([])
})

it.each([
  { hypertension: true, highBloodPressure: false },
  { conditionDetails: 'A', conditionDetail: 'B' },
  { conditionDetail: 'A', conditionNote: 'B' },
  { sleepCategory: '6時間以上', sleepDuration: '4時間未満' },
  { lastDivePeriod: '初めて', lastDiveExperience: '1ヶ月以内' },
  { consentAt: '2026-10-06', consentedAt: '2026-10-07' },
  { doctorClearance: '確認済', doctorDivingPermit: '未確認' },
  { staffCheckStatus: '確認済', staffReviewStatus: '未確認' },
  { staffCheckNote: 'A', staffReviewNotes: 'B' },
  { cCardType: 'AOW', cCardStatus: 'OW' },
  { hasCCard: true, cCardStatus: '未取得' },
  { hasCCard: false, cCardStatus: 'OW' },
])('別名の値が矛盾する問診は移行しない: %j', (record) => {
  expect(() => assertQuestionnaireAliases(record)).toThrow('別名項目が矛盾')
})

it('同じ意味のboolean・睡眠区分を受理し、空の新列より値のある旧列を保全する', () => {
  const record = {
    id: 'M-7', reservationId: 'R-7',
    hypertension: '', highBloodPressure: 'FALSE',
    conditionDetails: '', conditionNote: '確認事項',
    sleepCategory: '4時間以上6時間未満', sleepDuration: '4〜6時間',
  }
  const before = structuredClone(record)
  expect(normalizeQuestionnaireForMigration(record)).toMatchObject({
    hypertension: false, conditionDetails: '確認事項', sleepCategory: '4時間以上6時間未満',
  })
  expect(record).toEqual(before)
  expect(() => assertQuestionnaireAliases({ hypertension: false, highBloodPressure: 'FALSE' })).not.toThrow()
  expect(() => assertQuestionnaireAliases({ hypertension: true, highBloodPressure: 'true' })).not.toThrow()
  expect(() => assertQuestionnaireAliases({ hypertension: undefined, highBloodPressure: null })).not.toThrow()
  expect(() => assertQuestionnaireAliases({ staffCheckNote: 'A ', staffReviewNotes: ' A' })).not.toThrow()
})

it('旧Cカード区分から有無・種別を保全し、空の旧列で既存資格を上書きしない', () => {
  expect(normalizeQuestionnaireForMigration({ id: 'M-7', reservationId: 'R-7', cCardStatus: 'OW' }))
    .toMatchObject({ hasCCard: true, cCardType: 'OW' })
  expect(normalizeQuestionnaireForMigration({ id: 'M-7', reservationId: 'R-7', hasCCard: true, cCardType: 'AOW', cCardStatus: '' }))
    .toMatchObject({ hasCCard: true, cCardType: 'AOW' })
  expect(normalizeQuestionnaireForMigration({ id: 'M-7', reservationId: 'R-7', hasCCard: 'TRUE ', cCardType: 'AOW' }))
    .toMatchObject({ hasCCard: true, cCardType: 'AOW' })
})

it('未知のbooleanをfalseとして移行しない', () => {
  expect(() => assertQuestionnaireAliases({ hypertension: 'unknown' })).toThrow('boolean形式')
  expect(() => assertQuestionnaireAliases({ hasCCard: 'unknown' })).toThrow('boolean形式')
  expect(() => assertQuestionnaireAliases({ hasCCard: 'unknown', cCardStatus: '' })).toThrow('boolean形式')
})

it('ヘッダー幅外の値を捨てず、全シートの書込前に停止する', async () => {
  mock.values['問診票'][1].push('headerless-value')
  const before = structuredClone(mock.values)
  await expect(initializeSheets()).rejects.toThrow('ヘッダーのない列に値')
  expect(mock.values).toEqual(before)
  expect(mock.requests).toEqual([])
  expect(mock.backupCount).toBe(0)
})

it.each([false, true])('問診の矛盾を全シートの書込前に検出する（現行ヘッダー=%s）', async (current) => {
  const headers = current
    ? [...SHEET_HEADERS.QUESTIONNAIRES]
    : [...LEGACY_QUESTIONNAIRE_HEADERS, 'hypertension', 'highBloodPressure']
  mock.values['問診票'] = [headers, headers.map((header) => ({
    id: 'M-7', reservationId: 'R-7', hypertension: 'TRUE', highBloodPressure: 'FALSE',
  } as Record<string, string>)[header] ?? '')]
  const before = structuredClone(mock.values)
  await expect(initializeSheets()).rejects.toThrow('問診票 2行: 問診の別名項目が矛盾')
  expect(mock.values).toEqual(before)
  expect(mock.requests).toEqual([])
  expect(mock.backupCount).toBe(0)
})

it.each(['', 'AOW'])('旧Cカード列をバックアップ後に移し、通常読取・再移行でも資格を保持する（旧値=%s）', async (legacy) => {
  const headers = [...SHEET_HEADERS.QUESTIONNAIRES, 'cCardStatus', 'customMemo']
  mock.values['問診票'] = [headers, headers.map((header) => ({
    id: 'M-7', reservationId: 'R-7', hasCCard: 'TRUE', cCardType: 'AOW',
    cCardStatus: legacy, customMemo: '残す値',
  } as Record<string, string>)[header] ?? '')]
  await initializeSheets()
  expect(mock.backupCount).toBeGreaterThan(0)
  expect((await getQuestionnaires())[0]).toMatchObject({ hasCCard: true, cCardType: 'AOW' })
  const migrated = mock.values['問診票']
  expect(migrated[0]).not.toContain('cCardStatus')
  expect(migrated[1][migrated[0].indexOf('customMemo')]).toBe('残す値')
  const update = mock.requests.find((request) =>
    (request as { updateCells?: { range: { sheetId: number } } }).updateCells?.range.sheetId === 1,
  ) as { updateCells: { range: { endColumnIndex: number } } }
  expect(update.updateCells.range.endColumnIndex).toBe(headers.length)
  const before = structuredClone(mock.values)
  const backupCount = mock.backupCount
  await initializeSheets()
  expect(mock.values).toEqual(before)
  expect(mock.backupCount).toBe(backupCount)
})

it('空の高血圧新列と未知列を保全して移行し、再移行でも変化しない', async () => {
  const rows = mock.values['問診票']
  rows[0].push('highBloodPressure', 'customMemo')
  rows[1][rows[0].indexOf('hypertension')] = ''
  rows[1].push('FALSE', '残す値')
  await initializeSheets()
  expect((await getQuestionnaires())[0].hypertension).toBe(false)
  const migrated = mock.values['問診票']
  expect(migrated[1][migrated[0].indexOf('customMemo')]).toBe('残す値')
  const before = structuredClone(mock.values)
  await initializeSheets()
  expect(mock.values).toEqual(before)
})

it('矛盾エラーに個人情報・健康情報の値を含めない', () => {
  const record = { staffCheckNote: 'private-note-one', staffReviewNotes: 'private-note-two' }
  let message = ''
  try { assertQuestionnaireAliases(record) } catch (error) { message = (error as Error).message }
  expect(message).toContain('staffCheckNote / staffReviewNotes')
  expect(message).not.toContain('private-note')
})
