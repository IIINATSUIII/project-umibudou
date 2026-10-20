import { it,expect,vi,afterEach } from 'vitest'
const document=vi.hoisted(()=>({held:false,active:0,maxActive:0,created:0}))
vi.mock('googleapis',()=>({google:{auth:{GoogleAuth:class {}},firestore:()=>({projects:{databases:{documents:{
  createDocument:async()=>{
    if(document.held) throw Object.assign(new Error('exists'),{code:409})
    document.held=true;document.created++
  },
  delete:async()=>{document.held=false},
}}}})}}))
afterEach(()=>vi.unstubAllEnvs())
it('独立した実行インスタンスのSheets書き込みをFirestoreで直列化する',async()=>{
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL','test@example.com');vi.stubEnv('GOOGLE_PRIVATE_KEY','fake');vi.stubEnv('GOOGLE_SPREADSHEET_ID','fake');vi.stubEnv('GOOGLE_DATASTORE_LOCK_PROJECT_ID','test')
  document.held=false;document.active=0;document.maxActive=0;document.created=0
  const first=await import('../storeLock');vi.resetModules();const second=await import('../storeLock')
  const write=async()=>{document.active++;document.maxActive=Math.max(document.maxActive,document.active);await new Promise(r=>setTimeout(r,10));document.active--}
  await Promise.all([first.withStoreWriteLock(write),second.withStoreWriteLock(write)])
  expect(document.maxActive).toBe(1);expect(document.created).toBe(2);expect(document.held).toBe(false)
})
it('分散ロック未設定では書き込み処理を実行しない',async()=>{
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL','test@example.com');vi.stubEnv('GOOGLE_PRIVATE_KEY','fake');vi.stubEnv('GOOGLE_SPREADSHEET_ID','fake');vi.stubEnv('GOOGLE_DATASTORE_LOCK_PROJECT_ID','')
  const {withStoreWriteLock}=await import('../storeLock');const write=vi.fn()
  await expect(withStoreWriteLock(write)).rejects.toThrow('GOOGLE_DATASTORE_LOCK_PROJECT_ID')
  expect(write).not.toHaveBeenCalled()
})
