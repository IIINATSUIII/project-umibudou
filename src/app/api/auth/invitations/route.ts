import { NextRequest } from 'next/server'
import { requireAdminSession, staffJson } from '@/lib/staffAuth'
import {
  createStaffInvitation,
  DuplicateInvitationError,
  hasStaffDatabase,
  isValidStaffEmail,
  listStaffInvitations,
  normalizeStaffEmail,
} from '@/lib/staffAccounts'
import type { StaffRole } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req)
  if (!auth.ok) return auth.response
  if (!hasStaffDatabase()) return staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  try {
    return staffJson({ invitations: await listStaffInvitations() })
  } catch {
    return staffJson({ error: '招待一覧を取得できませんでした' }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req)
  if (!auth.ok) return auth.response
  let body: unknown
  try { body = await req.json() } catch { return staffJson({ error: '入力形式が不正です' }, { status: 400 }) }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return staffJson({ error: '入力形式が不正です' }, { status: 400 })
  }
  const input = body as Record<string, unknown>
  const email = typeof input.email === 'string' ? normalizeStaffEmail(input.email) : ''
  const role = input.role === undefined ? 'staff' : input.role
  if (!hasStaffDatabase()) return staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  if (!isValidStaffEmail(email) || (role !== 'admin' && role !== 'staff')) {
    return staffJson({ error: 'メールアドレスまたは権限が不正です' }, { status: 400 })
  }
  try {
    const result = await createStaffInvitation({ email, role: role as StaffRole, createdBy: auth.session.userId! })
    const inviteUrl = new URL(`/login?invite=${encodeURIComponent(result.token)}`, req.url).toString()
    return staffJson({ invitation: result.invitation, inviteUrl }, { status: 201 })
  } catch (error) {
    if (error instanceof DuplicateInvitationError) return staffJson({ error: 'このメールアドレスには有効な招待が既にあります' }, { status: 409 })
    console.error('[POST /api/auth/invitations] AUTH_INTERNAL_ERROR')
    return staffJson({ error: '招待を作成できませんでした' }, { status: 503 })
  }
}

