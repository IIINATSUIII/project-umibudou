import { NextRequest } from 'next/server'
import { requireAdminSession, staffJson } from '@/lib/staffAuth'
import { hasStaffDatabase, revokeStaffInvitation } from '@/lib/staffAccounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminSession(req)
  if (!auth.ok) return auth.response
  if (!hasStaffDatabase()) return staffJson({ error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  const { id } = await params
  try {
    if (!await revokeStaffInvitation(id)) return staffJson({ error: '招待が見つかりません' }, { status: 404 })
    return staffJson({ ok: true })
  } catch {
    return staffJson({ error: '招待を取り消せませんでした' }, { status: 503 })
  }
}

