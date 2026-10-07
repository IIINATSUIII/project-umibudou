import { describe, it, expect } from 'vitest'
import { normalizeReservation, normalizeQuestionnaire, HEADERS, LEGACY_QUESTIONNAIRE_HEADERS } from '../storeSchema'
import { changedCustomerFields } from '../customerEdit'
import { matchesCustomer } from '../customerSearch'
import { toSafeCsvCell } from '../csv'
import { findReservationByQuestionnaireToken, getQuestionnaireExpiry } from '../questionnaireToken'
import { validateQuestionnaireExperience } from '../questionnaireExperience'
import type { Customer } from '@/types'

describe('旧データと各PRの共通契約', () => {
  it('11列予約のID・連絡先・日時・人数・問診参照を保持する', () => {
    const r = normalizeReservation({id:'R-001',date:'2026-10-06',time:'13:30',course:'体験ダイビング',guestName:'田中',guestCount:'2',phone:'09012345678',channel:'sns',status:'confirmed',questionnaireId:'M-001',notes:'送迎あり'})
    expect(r).toMatchObject({id:'R-001',diveDate:'2026-10-06',timeSlot:'afternoon',legacyTime:'13:30',guestCount:2,guestPhone:'09012345678',status:'STS-03',questionnaireId:'M-001',questionnaireCompleted:true,staffNote:'送迎あり'})
  })
  it('問診の元37列を保持し、各PRの追加列を重複させない', () => {
    expect(HEADERS.QUESTIONNAIRES.slice(0,37)).toEqual(LEGACY_QUESTIONNAIRE_HEADERS)
    expect(new Set(HEADERS.QUESTIONNAIRES).size).toBe(HEADERS.QUESTIONNAIRES.length)
    const q = normalizeQuestionnaire({id:'M-001',reservationId:'R-001',heartDisease:'TRUE',agreePhoto:'FALSE',sleepHours:'',totalDives:'0',highBloodPressure:'TRUE',conditionDetail:'頭痛',doctorDivingPermit:'持参あり'})
    expect(q).toMatchObject({heartDisease:true,agreePhoto:false,sleepHours:null,totalDives:0,hypertension:true,conditionDetails:'頭痛',doctorClearance:'持参あり'})
  })
  it('編集した項目だけを競合再送用の差分に含める', () => {
    expect(changedCustomerFields({phone:'0901',email:'old@example.com',guideNotes:'旧メモ'}, {phone:'0902',email:'old@example.com',guideNotes:'旧メモ'})).toEqual({phone:'0902'})
  })
  it.each(['山田太郎','山田 太郎','山田　太郎','ヤマダ タロウ'])('フルネーム %s を検索できる', query => {
    expect(matchesCustomer({id:'C-1',lastName:'山田',firstName:'太郎',lastNameKana:'ヤマダ',firstNameKana:'タロウ',phone:'',email:''} as Customer,query)).toBe(true)
  })
  it.each(['=1+1','+cmd','-1','@SUM(A1)','\t=1','\r=1','\n=1'])('CSVの式・制御文字を無効化する %j', value => {
    expect(toSafeCsvCell(value)).toBe(`"'${value}"`)
  })
  it('初回・未取得・本数未回答と明示的な0を区別して受理する', () => {
    const input={sleepCategory:'6時間以上',alcoholLastNight:false,alcoholToday:false,flightWithin48h:false,condition:'good',hasCCard:false,cCardType:'未取得',cCardOrg:'',lastDivePeriod:'初めて',totalDives:null}
    expect(validateQuestionnaireExperience(input)).toEqual({})
    expect(validateQuestionnaireExperience({...input,totalDives:0})).toEqual({})
    expect(validateQuestionnaireExperience({...input,totalDives:-1})).toHaveProperty('totalDives')
  })
  it('公開URLは秘密トークン、有限の有効期限、未キャンセルに限定する', () => {
    const r=normalizeReservation({id:'R-001',date:'2026-10-06',status:'confirmed',questionnaireToken:'secret',questionnaireExpiresAt:'2026-10-06T15:00:00Z'})
    const now = new Date('2026-10-06T00:00:00Z')
    expect(findReservationByQuestionnaireToken([r],'R-001',now)).toBeUndefined()
    expect(findReservationByQuestionnaireToken([r],'secret',now)?.id).toBe('R-001')
    for(const expiry of ['', 'invalid', '2026-10-05T15:00:00Z']) expect(findReservationByQuestionnaireToken([{...r,questionnaireTokenExpiresAt:expiry}],'secret',now)).toBeUndefined()
    for (const status of ['STS-04', 'canceled', 'cancelled', 'CANCELLED', 'STS-06']) {
      expect(findReservationByQuestionnaireToken([{...r,status}],'secret',now)).toBeUndefined()
    }
    expect(getQuestionnaireExpiry('2026-10-06')).toBe('2026-10-06T15:00:00.000Z')
  })
})
