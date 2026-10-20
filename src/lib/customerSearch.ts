import type { Customer } from '@/types'
const normalize = (v: string) =>
  v.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s/g, '')
export function matchesCustomer(c: Customer, query: string): boolean {
  const q = normalize(query)
  if (!q) return true
  return [
    c.id,
    c.lastName,
    c.firstName,
    `${c.lastName}${c.firstName}`,
    c.lastNameKana,
    c.firstNameKana,
    `${c.lastNameKana}${c.firstNameKana}`,
    c.phone,
    c.email,
  ].some((v) => normalize(v || '').includes(q))
}
