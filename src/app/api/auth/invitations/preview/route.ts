import { NextRequest } from 'next/server'
import { staffJson } from '@/lib/staffAuth'
import { findInvitationByToken, hasStaffDatabase } from '@/lib/staffAccounts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!hasStaffDatabase() || !token) return staffJson({ error: '招待リンクが無効です' }, { status: 404 })
  try {
    const invitation = await findInvitationByToken(token)
    if (!invitation || invitation.usedAt || invitation.revokedAt || new Date(invitation.expiresAt) <= new Date()) {
      return staffJson({ error: '招待リンクが無効または期限切れです' }, { status: 410 })
    }
    return staffJson({ email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt })
  } catch {
    return staffJson({ error: '招待を確認できません' }, { status: 503 })
  }
}

