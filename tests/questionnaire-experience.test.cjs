const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error('Unexpected dependency ' + name);
  }, console, process: {env:{}} });
  return exports;
}
const validation = load('src/lib/questionnaireValidation.ts');
const valid = {
  sleepCategory: '6時間以上', alcoholLastNight: false, alcoholToday: false,
  condition: 'good', conditionDetails: '', flightWithin48h: false,
  hasCCard: false, cCardType: '未取得', cCardOrg: '', lastDivePeriod: '初めて', totalDives: null,
  agreeRisk: true, agreeMedical: true, agreePhoto: false, reservationId: 'R-test',
  lastName: 'テスト', firstName: '太郎'
};
test('Sheets keeps legacy columns and round-trips new fields, null and zero', async () => {
  const rows = [];
  const sheets = load('src/lib/sheets.ts', {googleapis:{google:{auth:{GoogleAuth:class {}},sheets:()=>({spreadsheets:{values:{
    append:async request => rows.push(request.requestBody.values[0]),
    get:async()=>({data:{values:rows}})
  }}})}}});
  const headers = sheets.HEADERS.QUESTIONNAIRES;
  assert.equal(headers.indexOf('agreePhoto'),36);
  assert.equal(headers.indexOf('sleepCategory'),37);
  assert.equal(headers.indexOf('conditionDetails'),38);
  assert.equal(headers.indexOf('lastDivePeriod'),39);
  const legacy = {...valid,id:'legacy',sleepHours:7,lastDiveDate:'2026-03-10',totalDives:150};
  rows.push(headers.slice(0,37).map(key => legacy[key] == null ? '' : String(legacy[key])));
  for (const totalDives of [null,0]) await sheets.addQuestionnaire(validation.normalizeQuestionnaireExperience({...valid,totalDives,condition:'bad',conditionDetails:' 詳細 '}));
  const result = await sheets.getQuestionnaires();
  assert.equal(result[0].sleepHours,7);
  assert.equal(result[0].lastDiveDate,'2026-03-10');
  assert.equal(result[0].sleepCategory,'');
  assert.equal(result[1].totalDives,null);
  assert.equal(result[2].totalDives,0);
  assert.equal(result[1].sleepHours,null);
  assert.equal(result[1].sleepCategory,'6時間以上');
  assert.equal(result[1].lastDivePeriod,'初めて');
  assert.equal(result[1].flightWithin48h,false);
  assert.equal(result[1].conditionDetails,'詳細');
});
test('explicit false and optional blank/zero are accepted', () => {
  for (const totalDives of [null, undefined, 0, 100]) assert.equal(Object.keys(validation.validateQuestionnaireExperience({...valid, totalDives})).length, 0);
  assert.equal(validation.normalizeQuestionnaireExperience(valid).totalDives, null);
  assert.equal(validation.normalizeQuestionnaireExperience({...valid, totalDives: 0}).totalDives, 0);
});
test('missing responses, wrong types, enums, and noninteger counts are rejected', () => {
  for (const key of ['sleepCategory','alcoholLastNight','alcoholToday','condition','flightWithin48h','cCardType','hasCCard','lastDivePeriod']) {
    const body = {...valid}; delete body[key];
    assert.ok(Object.keys(validation.validateQuestionnaireExperience(body)).length, key);
  }
  for (const totalDives of [-1, 0.1, '0', '', false, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.ok(validation.validateQuestionnaireExperience({...valid,totalDives}).totalDives);
  for (const flightWithin48h of ['false', 0, null]) assert.ok(validation.validateQuestionnaireExperience({...valid,flightWithin48h}).flightWithin48h);
  assert.ok(validation.validateQuestionnaireExperience({...valid, cCardOrg:'unknown'}).cCardOrg);
  assert.ok(validation.validateQuestionnaireExperience({...valid, hasCCard:true}).cCardType);
});
test('condition details and all designed choices', () => {
  for (const conditionDetails of ['', '  ', null, 'x'.repeat(1001)]) assert.ok(validation.validateQuestionnaireExperience({...valid, condition:'bad',conditionDetails}).conditionDetails);
  assert.equal(Object.keys(validation.validateQuestionnaireExperience({...valid, condition:'bad', conditionDetails:' 頭痛 ', flightWithin48h:true})).length,0);
  assert.equal(validation.normalizeQuestionnaireExperience({...valid,condition:'bad',conditionDetails:' 頭痛 '}).conditionDetails,'頭痛');
  for (const cCardType of validation.CARD_OPTIONS) assert.equal(Object.keys(validation.validateQuestionnaireExperience({...valid,cCardType,hasCCard:cCardType!=='未取得'})).length,0);
  for (const lastDivePeriod of validation.DIVE_OPTIONS) assert.equal(Object.keys(validation.validateQuestionnaireExperience({...valid,lastDivePeriod})).length,0);
  for (const sleepCategory of validation.SLEEP_OPTIONS) assert.equal(Object.keys(validation.validateQuestionnaireExperience({...valid,sleepCategory})).length,0);
});
for (const file of ['src/app/api/public/questionnaires/route.ts','src/app/api/questionnaires/route.ts']) {
  test(file + ': invalid bodies never access store; valid false response is persisted', async () => {
    const calls = [];
    const store = Object.fromEntries(['getReservations','addQuestionnaire','updateReservation','getCustomers','addCustomer'].map(name => [name, async (...args) => {
      calls.push([name,...args]);
      return name === 'getReservations' ? [{id:'R-test'}] : [];
    }]));
    const route = load(file, {'@/lib/questionnaireValidation':validation,'@/lib/dataStore':{store},'next/server':{NextResponse:{json:(body, init) => ({body,status:init?.status ?? 200})}}});
    for (const body of [null, [], {}, {...valid,flightWithin48h:null}, {...valid,totalDives:1.2}, {...valid,condition:'bad'}]) {
      const response = await route.POST({json:async()=>body});
      assert.equal(response.status,400);
      assert.equal(calls.length,0);
    }
    assert.equal((await route.POST({json:async()=>{throw new SyntaxError()}})).status,400);
    assert.equal(calls.length,0);
    assert.equal((await route.POST({json:async()=>valid})).status,200);
    const saved = calls.find(([name]) => name === 'addQuestionnaire')[1];
    assert.equal(saved.flightWithin48h,false);
    assert.equal(saved.agreePhoto,false);
    assert.equal(saved.totalDives,null);
    assert.equal(saved.sleepCategory,'6時間以上');
  });
}
