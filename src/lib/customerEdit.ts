import type { Customer } from '@/types'
/** 再送でもこの差分を保持し、編集していない項目は送らない。 */
export function changedCustomerFields(
  baseline: Partial<Customer>,
  values: Partial<Customer>
): Partial<Customer> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !Object.is(value, baseline[key as keyof Customer])
    )
  )
}
