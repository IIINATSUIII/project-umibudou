import { NextRequest } from 'next/server'
import { requireAdminSession, staffJson } from '@/lib/staffAuth'
import {
  hasStaffDatabase,
  listStaffUsers,
  LastAdminError,
  updateStaffUser,
} from '@/lib/staffAccounts'
import type { StaffRole } from '@/lib/session'
import type { StaffStatus } from '@/lib/staffAccounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req)
  if (!auth.ok) return auth.response
  if (!hasStaffDatabase()) return staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  try { return staffJson({ staff: await listStaffUsers() }) }
  catch { return staffJson({ error: 'スタッフ一覧を取得できませんでした' }, { status: 503 }) }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminSession(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return staffJson({ error: '入力形式が不正です' }, { status: 400 }) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return staffJson({ error: '入力形式が不正です' }, { status: 400 })
  const input = body as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id : ''
  const role = input.role
  const status = input.status
  if (!id || (role !== undefined && role !== 'admin' && role !== 'staff') ||
      (status !== undefined && status !== 'active' && status !== 'suspended')) {
    return staffJson({ error: '更新内容が不正です' }, { status: 400 })
  }
  try {
    const staff = await updateStaffUser({ id, role: role as StaffRole | undefined, status: status as StaffStatus | undefined })
    return staffJson({ staff })
  } catch (error) {
    if (error instanceof LastAdminError) return staffJson({ error: '最後の管理者は停止・降格できません' }, { status: 409 })
    if (error instanceof Error && error.message === 'STAFF_NOT_FOUND') return staffJson({ error: 'スタッフが見つかりません' }, { status: 404 })
    return staffJson({ error: 'スタッフを更新できませんでした' }, { status: 503 })
  }
}

