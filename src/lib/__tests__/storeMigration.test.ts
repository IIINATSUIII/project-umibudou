import { it, expect, vi, beforeEach } from 'vitest'
import { HEADERS, LEGACY_RESERVATION_HEADERS, LEGACY_QUESTIONNAIRE_HEADERS } from '../storeSchema'
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
import { getReservations, getQuestionnaires, updateReservation, initializeSheets } from '../sheets'

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
