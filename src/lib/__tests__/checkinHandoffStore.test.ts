import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { dismissCheckinHandoff, enqueueCheckinHandoff, listCheckinHandoffs } from '../checkinHandoffStore'

let directory: string
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-test-'))
  vi.stubEnv('LOCAL_DATA_DIR', directory)
  vi.stubEnv('DATA_STORE', 'json')
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '')
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }) })
it('persists concurrent duplicate scans once and permits rescan after dismissal', async () => {
  const expiry = new Date(Date.now() + 3600000).toISOString()
  await Promise.all([enqueueCheckinHandoff('Q1', expiry), enqueueCheckinHandoff('Q1', expiry), enqueueCheckinHandoff('Q2', expiry)])
  const items = await listCheckinHandoffs()
  expect(items).toHaveLength(2)
  expect(JSON.parse(await fs.readFile(path.join(directory, 'checkin-handoffs.json'), 'utf8'))).toHaveLength(2)
  const first = items.find(row => row.questionnaireId === 'Q1')!
  await dismissCheckinHandoff(first.id)
  expect(await listCheckinHandoffs()).toHaveLength(1)
  await enqueueCheckinHandoff('Q1', expiry)
  expect(await listCheckinHandoffs()).toHaveLength(2)
})
it('expires previous entries', async () => {
  await enqueueCheckinHandoff('old', new Date(Date.now() - 1000).toISOString())
  expect(await listCheckinHandoffs()).toEqual([])
  await enqueueCheckinHandoff('new', new Date(Date.now() + 3600000).toISOString())
  expect((await listCheckinHandoffs()).map(row => row.questionnaireId)).toEqual(['new'])
})
