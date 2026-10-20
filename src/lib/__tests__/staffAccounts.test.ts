import { describe, expect, it } from 'vitest'
import { hashStaffPassword, validateStaffPassword, verifyStaffPassword } from '../staffAccounts'

describe('招待スタッフのパスワード保護', () => {
  it('5文字未満を拒否し、scryptハッシュを保存する', async () => {
    expect(validateStaffPassword('1234')).toBe(false)
    expect(validateStaffPassword('12345')).toBe(true)
    const password = 'correct horse battery staple'
    const encoded = await hashStaffPassword(password)
    expect(encoded).toMatch(/^scrypt\$/)
    expect(encoded).not.toContain(password)
    expect(await verifyStaffPassword(password, encoded)).toBe(true)
    expect(await verifyStaffPassword('wrong password 123', encoded)).toBe(false)
  })

  it('壊れたハッシュ形式を認証成功として扱わない', async () => {
    await expect(hashStaffPassword('1234')).rejects.toThrow()
    expect(await verifyStaffPassword('correct horse battery staple', 'plain-text-password')).toBe(false)
    expect(await verifyStaffPassword('correct horse battery staple', 'scrypt$1$1$1$bad$bad')).toBe(false)
  })
})

