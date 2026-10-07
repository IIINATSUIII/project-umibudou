import { it,expect,vi,beforeEach,afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {getReservations,updateReservation,addReservation} from '../localStore'
import type {Reservation} from '@/types'
let directory:string
beforeEach(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'odp-local-test-'));vi.stubEnv('LOCAL_DATA_DIR',directory);vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL','')})
afterEach(async()=>{vi.unstubAllEnvs();await fs.rm(directory,{recursive:true,force:true})})
it('旧JSONを読め、更新時に元ファイルのバックアップを保持する',async()=>{
  const raw=JSON.stringify([{id:'R-1',date:'2026-10-06',time:'13:00',guestName:'田中',guestCount:2,phone:'090',course:'体験ダイビング',status:'pending',questionnaireId:'M-1'}])
  await fs.writeFile(path.join(directory,'reservations.json'),raw)
  expect((await getReservations())[0]).toMatchObject({guestPhone:'090',questionnaireId:'M-1',legacyTime:'13:00'})
  await updateReservation('R-1',{status:'STS-03'})
  expect(await fs.readFile(path.join(directory,'reservations.json.before-review-migration'),'utf8')).toBe(raw)
  expect((await getReservations())[0]).toMatchObject({id:'R-1',status:'STS-03',questionnaireId:'M-1'})
})
it('破損JSONをモックデータで上書きしない',async()=>{
  await fs.writeFile(path.join(directory,'reservations.json'),'{broken')
  await expect(addReservation({id:'R-new'} as Reservation)).rejects.toThrow()
  expect(await fs.readFile(path.join(directory,'reservations.json'),'utf8')).toBe('{broken')
})
it('独立したロックインスタンスから並列追加しても行を失わない',async()=>{
  await fs.writeFile(path.join(directory,'reservations.json'),'[]')
  vi.resetModules();const other=await import('../localStore')
  await Promise.all([
    addReservation({id:'R-a',diveDate:'2026-10-06'} as Reservation),
    other.addReservation({id:'R-b',diveDate:'2026-10-06'} as Reservation),
  ])
  expect((await getReservations()).map(r=>r.id).sort()).toEqual(['R-a','R-b'])
})
