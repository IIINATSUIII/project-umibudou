const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(source, { exports, require: (name) => {
    if (name === 'crypto') return require('node:crypto')
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`)
    return dependencies[name]
  }, console, Date, Intl, URL, process: { env: {} } })
  return exports
}
const validation = load('src/lib/questionnaireValidation.ts')
const schema = load('src/lib/questionnaireSchema.ts')
const tokens = load('src/lib/questionnaireToken.ts')
const utils = load('src/lib/questionnaireUtils.ts')
test('旧タイムスタンプ顧客IDを保持し、連番だけで採番する',()=>{
  assert.equal(utils.nextCustomerId(['C001','C-0002','C1788844128909']),'C-0003')
  assert.throws(()=>utils.nextCustomerId(['C-9999']))
})
const valid = {
  lastName: '田中', firstName: '花子', lastNameKana: 'タナカ', firstNameKana: 'ハナコ',
  birthDate: '1995-06-15', gender: 'unanswered', postalCode: '900-0001', address: '沖縄県那覇市',
  phone: '090-1234-5678', email: 'test@example.com', emergencyName: '田中 太郎',
  emergencyRelation: '家族', emergencyPhone: '098-123-4567',
  ...Object.fromEntries(validation.HEALTH_FIELDS.map(([key]) => [key, false])),
  medication: false, medicationName: '', medicalCertificate: false,
  sleepHours: null, sleepCategory: '6時間以上', alcoholLastNight: false, alcoholToday: false,
  condition: 'normal', conditionDetails: '', flightWithin48h: false,
  hasCCard: false, cCardType: '未取得', cCardOrg: '', lastDivePeriod: '初めて', lastDiveDate: '', totalDives: null,
  agreeRisk: true, agreeMedical: true, agreePhoto: false,
}
test('満年齢の境界と不正日付', () => {
  assert.equal(validation.calculateAge('2000-09-08', '2026-09-07'), 25)
  assert.equal(validation.calculateAge('2000-09-08', '2026-09-08'), 26)
  assert.equal(validation.calculateAge('2000-02-29', '2025-02-28'), 24)
  assert.equal(validation.calculateAge('2000-02-29', '2025-03-01'), 25)
  for (const value of ['2025-02-29','2026-02-30','0000-01-01','2027-01-01','invalid']) assert.equal(validation.calculateAge(value,'2026-09-08'),null)
})
test('基本・健康必須と形式、なしは有効', () => {
  assert.equal(Object.keys(validation.validateQuestionnaire(valid)).length,0)
  for (const key of validation.BASIC_FIELDS.filter((k)=>k!=='gender')) assert.ok(validation.validateQuestionnaire({...valid,[key]:' '})[key])
  for (const key of [...validation.HEALTH_FIELDS.map(([k])=>k),'medication','medicalCertificate']) {
    for(const value of [null,undefined,'false',0]) assert.ok(validation.validateQuestionnaire({...valid,[key]:value})[key])
  }
  for(const [key,value] of [['email','a@'],['phone','０９０'],['postalCode','123'],['lastNameKana','たなか'],['birthDate','2999-01-01']]) assert.ok(validation.validateQuestionnaire({...valid,[key]:value})[key])
  assert.ok(validation.validateQuestionnaire({...valid,medication:true}).medicationName)
})
test('統一契約：睡眠null・初回・総本数null・未回答性別・写真不許可を受理', () => {
  const result=validation.validateQuestionnaireInput({...valid,doctorClearance:'持参あり',qrToken:'forged',customerId:'forged',sleepHours:7})
  assert.equal(result.ok,true);assert.equal(result.data.sleepHours,null);assert.equal(result.data.totalDives,null);assert.equal(result.data.lastDiveDate,'')
  for(const key of ['doctorClearance','qrToken','customerId']) assert.equal(key in result.data,false)
  assert.equal(result.data.medicalCertificate,false);assert.equal(result.data.agreePhoto,false)
})
test('体調詳細・経験・同意の不整合を拒否', () => {
  for(const [patch,key] of [[{condition:'bad'},'conditionDetails'],[{condition:'bad',conditionDetail:'旧名のみ'},'conditionDetails'],[{sleepCategory:''},'sleepCategory'],[{totalDives:2},'totalDives'],[{totalDives:'0'},'totalDives'],[{lastDivePeriod:''},'lastDivePeriod'],[{cCardType:'OW'},'cCardType'],[{agreePhoto:null},'agreePhoto'],[{agreeRisk:false},'agreeRisk']]) assert.ok(validation.validateQuestionnaire({...valid,...patch})[key],key)
  assert.equal(validation.validateQuestionnaireInput({...valid,condition:'bad',conditionDetails:'頭痛'}).ok,true)
})
test('各旧PRのヘッダー配置を移行し、null・未知列・再実行を保持',()=>{
  const base=Array.from(schema.QUESTIONNAIRE_COLUMNS).slice(0,37)
  const variants=[['postalCode','email','hypertension','medicalCertificate'],['sleepCategory','conditionDetails','lastDivePeriod'],['qrToken','qrIssuedAt','qrExpiresAt','qrUsed','doctorClearance','staffCheckStatus','staffCheckNote'],['postalCode','email','hypertension','conditionDetail'],['customerId','postalCode','email','highBloodPressure','conditionDetails','consentAt','qrToken','qrExpiresAt','qrUsed','doctorDivingPermit','staffReviewStatus','staffReviewNotes']]
  for(const extra of variants){
    const headers=extra.includes('staffCheckStatus') ? [...base.slice(0,3),...extra,...base.slice(3),'futureColumn'] : [...base,...extra,'futureColumn']
    const record={...valid,id:'Q-old',hypertension:true,highBloodPressure:true,doctorClearance:'持参あり',doctorDivingPermit:'持参あり',conditionDetail:'頭痛',conditionDetails:'頭痛',futureColumn:'preserve',staffCheckStatus:'確認済',staffReviewStatus:'確認済'}
    const table=[headers,headers.map(k=>record[k]==null?'':String(record[k]))]
    const migrated=schema.migrateQuestionnaireTable(table)
    assert.equal(JSON.stringify(schema.migrateQuestionnaireTable(migrated)),JSON.stringify(migrated))
    const q=schema.readQuestionnaireTable(migrated)[0]
    assert.equal(q.futureColumn,'preserve');assert.equal(q.totalDives,null);assert.equal(q.sleepHours,null)
    if(extra.includes('hypertension')||extra.includes('highBloodPressure')) assert.equal(q.highBloodPressure,true)
    if(extra.includes('doctorClearance')||extra.includes('doctorDivingPermit')) {assert.equal(q.doctorClearance,'持参あり');assert.equal(q.medicalCertificate,undefined)}
  }
})
test('移行は矛盾・重複・無名列を停止、JSONの別名も統一',()=>{
  assert.throws(()=>schema.migrateQuestionnaireTable([['id','hypertension','highBloodPressure'],['Q',true,false]]))
  assert.throws(()=>schema.migrateQuestionnaireTable([['id','id'],['Q','X']]))
  assert.throws(()=>schema.migrateQuestionnaireTable([['id'],['Q','unlabelled']]))
  assert.throws(()=>schema.requireCanonicalHeaders(['id','postalCode']))
  const q=schema.normalizeQuestionnaireRecord({hypertension:true,conditionDetail:'頭痛',medicalCertificate:false,doctorDivingPermit:'持参あり'})
  assert.equal(q.highBloodPressure,true);assert.equal(q.conditionDetails,'頭痛');assert.equal(q.medicalCertificate,false);assert.equal(q.doctorClearance,'持参あり')
})
const json=(body,options)=>({body,status:options?.status??200,headers:options?.headers})
function api(){
  const accessToken=tokens.createToken()
  const reservation={id:'R-test',date:'2099-10-06',status:'confirmed',questionnaireToken:accessToken,questionnaireExpiresAt:tokens.getQuestionnaireExpiry('2099-10-06')}
  const questionnaires=[],customers=[]
  const store={getReservations:async()=>[reservation],getQuestionnaires:async()=>questionnaires,getCustomers:async()=>customers,
    addQuestionnaire:async data=>{const q={...data,id:'M-0001'};questionnaires.push(q);return q},
    updateReservation:async(id,data)=>Object.assign(reservation,data),addCustomer:async(data)=>customers.push(data),
    updateCustomer:async(id,data)=>Object.assign(customers.find(c=>c.id===id),data)}
  const deps={'next/server':{NextResponse:{json}},'@/lib/dataStore':{store},'@/lib/questionnaireValidation':validation,'@/lib/questionnaireToken':tokens,'@/lib/questionnaireUtils':utils}
  const route=load('src/app/api/public/questionnaires/route.ts',deps)
  const issue=load('src/app/api/reservations/[id]/questionnaire-url/route.ts',deps)
  return {accessToken,reservation,questionnaires,customers,issue,post:body=>route.POST({json:async()=>body}),get:token=>route.GET({nextUrl:new URL('http://localhost/api/public/questionnaires?accessToken='+token)})}
}
test('入力資格：予約ID・body.token・期限切れ・取消を拒否',async()=>{
  const a=api()
  for(const credentials of [{reservationId:'R-test'},{token:a.accessToken},{accessToken:'R-test'},{accessToken:tokens.createToken()}]) assert.equal((await a.post({...valid,...credentials})).status,404)
  a.reservation.status='cancelled';assert.equal((await a.post({...valid,accessToken:a.accessToken})).status,404);assert.equal((await a.get(a.accessToken)).status,404)
  a.reservation.status='confirmed';a.reservation.questionnaireExpiresAt=new Date(0).toISOString()
  assert.equal((await a.get(a.accessToken)).status,404);assert.equal(a.questionnaires.length,0)
})
test('発行・再発行・失効はPOST/GETの同じ契約を利用',async()=>{
  const a=api(), req={nextUrl:new URL('http://localhost')},params={params:{id:'R-test'}}
  const issued=await a.issue.POST(req,params)
  assert.equal(issued.status,200);assert.notEqual(issued.body.accessToken,a.accessToken)
  assert.equal((await a.get(a.accessToken)).status,404);assert.equal((await a.get(issued.body.accessToken)).status,200)
  assert.equal((await a.issue.DELETE(req,params)).status,200)
  assert.equal((await a.get(issued.body.accessToken)).status,404);assert.equal((await a.post({...valid,accessToken:issued.body.accessToken})).status,404)
})
test('公開API：検証拒否・保存・再表示・冪等・スタッフ情報の分離',async()=>{
  const a=api()
  assert.equal((await a.post(null)).status,400)
  assert.equal((await a.post({...valid,accessToken:a.accessToken,email:''})).status,400);assert.equal(a.questionnaires.length,0)
  const payload={...valid,accessToken:a.accessToken,highBloodPressure:true,medicalCertificate:true,doctorClearance:'持参あり',qrToken:'forged'}
  const result=await a.post(payload)
  assert.equal(result.status,200);assert.notEqual(result.body.qrToken,a.accessToken);assert.notEqual(result.body.qrToken,'forged')
  assert.equal(a.questionnaires[0].doctorClearance,'');assert.equal(a.questionnaires[0].medicalCertificate,true)
  assert.equal(a.customers[0].email,valid.email);assert.equal(a.questionnaires[0].totalDives,null)
  const get=await a.get(a.accessToken);assert.equal(get.body.qrToken,result.body.qrToken);assert.equal(get.headers['Cache-Control'],'no-store')
  assert.equal((await a.post(payload)).status,200);assert.equal(a.questionnaires.length,1);assert.equal(a.customers[0].visitCount,1)
  assert.equal((await a.get(result.body.qrToken)).status,404)
  a.questionnaires[0].qrUsed=true;assert.equal((await a.get(a.accessToken)).status,410);assert.equal((await a.post(payload)).status,410)
})
test('期限境界・無効なQR期限を拒否',()=>{
  const expiry=tokens.getQuestionnaireExpiry('2026-10-06')
  assert.equal(expiry,'2026-10-06T15:00:00.000Z');assert.throws(()=>tokens.getQuestionnaireExpiry('2026-02-30'))
  const q={qrToken:'qr',qrUsed:false,qrExpiresAt:expiry}
  assert.equal(tokens.isQrValid(q,Date.parse(expiry)-1),true);assert.equal(tokens.isQrValid(q,Date.parse(expiry)),false)
  assert.equal(tokens.isQrValid({...q,qrExpiresAt:'invalid'}),false)
})

test('Sheets保存：旧配置への書込を止め、新配置で53列と未知列を保持', async()=>{
  let table=[['id','postalCode'],['Q-old','900-0001']], writes=0
  const sheets=load('src/lib/sheets.ts',{
    './questionnaireSchema':schema, './questionnaireUtils':utils,
    googleapis:{google:{auth:{GoogleAuth:class{}},sheets:()=>({spreadsheets:{values:{
      get:async()=>({data:{values:table}}),
      append:async({requestBody})=>{writes++;table.push(...requestBody.values)},
    }}})}}
  })
  await assert.rejects(sheets.addQuestionnaire({...valid,reservationId:'R'}))
  assert.equal(writes,0)
  table=schema.migrateQuestionnaireTable(table)
  await sheets.addQuestionnaire({...valid,reservationId:'R',qrIssuedAt:'2026-10-06T00:00:00Z'})
  const q=(await sheets.getQuestionnaires()).find(q=>q.reservationId==='R')
  assert.equal(q.totalDives,null);assert.equal(q.sleepHours,null);assert.equal(q.sleepCategory,'6時間以上')
  assert.equal(q.qrIssuedAt,'2026-10-06T00:00:00Z');assert.equal(q.medicalCertificate,false)
})
