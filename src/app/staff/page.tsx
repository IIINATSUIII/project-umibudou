'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuthUser } from '@/lib/authContext'

type Staff = { id: string; email: string; displayName: string; role: 'admin' | 'staff'; status: 'active' | 'suspended' }
type Invitation = { id: string; email: string; role: 'admin' | 'staff'; expiresAt: string }

export default function StaffPage() {
  const user = useAuthUser()
  const router = useRouter()
  const [staff, setStaff] = useState<Staff[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'staff'>('staff')
  const [inviteUrl, setInviteUrl] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const [staffResponse, invitationResponse] = await Promise.all([
      fetch('/api/auth/staff', { cache: 'no-store' }),
      fetch('/api/auth/invitations', { cache: 'no-store' }),
    ])
    if (!staffResponse.ok) { setError('スタッフ管理を利用できません'); return }
    const staffData = await staffResponse.json()
    const inviteData = await invitationResponse.json()
    setStaff(staffData.staff ?? [])
    setInvitations(inviteData.invitations ?? [])
  }

  useEffect(() => {
    if (user === undefined) return
    if (!user || user.role !== 'admin') { router.replace('/dashboard'); return }
    load().catch(() => setError('スタッフ情報を取得できません'))
  }, [user, router])

  async function createInvite(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setInviteUrl('')
    const response = await fetch('/api/auth/invitations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { setError(data.error || '招待を作成できません'); return }
    setInviteUrl(data.inviteUrl); setMessage('招待リンクを作成しました。安全な方法で本人へ共有してください。'); setEmail(''); await load()
  }

  async function updateStaff(id: string, patch: Partial<Pick<Staff, 'role' | 'status'>>) {
    const response = await fetch('/api/auth/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { setError(data.error || 'スタッフを更新できません'); return }
    await load()
  }

  async function revoke(id: string) {
    const response = await fetch(`/api/auth/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok) { setError('招待を取り消せません'); return }
    await load()
  }

  if (user === undefined || !user || user.role !== 'admin') return <div className="min-h-screen flex items-center justify-center text-gray-400">読み込み中…</div>

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 space-y-6">
        <h1 className="text-xl font-bold text-gray-800">👤 スタッフ管理</h1>
        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {message && <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{message}</p>}

        <section className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-1">スタッフを招待（任意）</h2>
          <p className="text-xs text-gray-500 mb-3">スタッフは招待なしでもログイン画面から登録できます。権限を指定して登録してもらう場合だけ招待リンクを使います。</p>
          <form onSubmit={createInvite} className="flex flex-col sm:flex-row gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="staff@example.com" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'staff')} className="border rounded-lg px-3 py-2 text-sm"><option value="staff">スタッフ</option><option value="admin">管理者</option></select>
            <button className="bg-ocean-600 text-white rounded-lg px-4 py-2 text-sm">招待リンクを作成</button>
          </form>
          {inviteUrl && <div className="mt-3"><p className="text-xs text-gray-500 mb-1">このリンクは一度だけ表示されます。コピーして本人へ共有してください。</p><input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} className="w-full border rounded-lg px-3 py-2 text-xs bg-gray-50" /></div>}
        </section>

        <section className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3">登録済みスタッフ</h2>
          <div className="divide-y">
            {staff.map((member) => <div key={member.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1"><p className="text-sm font-medium">{member.displayName}</p><p className="text-xs text-gray-500">{member.email}</p></div>
              <select value={member.role} onChange={(e) => updateStaff(member.id, { role: e.target.value as Staff['role'] })} className="border rounded px-2 py-1 text-xs"><option value="staff">スタッフ</option><option value="admin">管理者</option></select>
              <button onClick={() => updateStaff(member.id, { status: member.status === 'active' ? 'suspended' : 'active' })} className="border rounded px-2 py-1 text-xs">{member.status === 'active' ? '停止' : '再開'}</button>
              <span className={`text-xs ${member.status === 'active' ? 'text-green-600' : 'text-gray-400'}`}>{member.status === 'active' ? '有効' : '停止中'}</span>
            </div>)}
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3">有効な招待</h2>
          {invitations.length === 0 ? <p className="text-sm text-gray-400">有効な招待はありません。</p> : <div className="divide-y">{invitations.map((invite) => <div key={invite.id} className="py-3 flex items-center gap-3"><div className="flex-1 text-sm">{invite.email}<span className="text-xs text-gray-400 ml-2">{invite.role === 'admin' ? '管理者' : 'スタッフ'} / {new Date(invite.expiresAt).toLocaleString('ja-JP')}</span></div><button onClick={() => revoke(invite.id)} className="text-xs text-red-600">取り消す</button></div>)}</div>}
        </section>
      </main>
    </div>
  )
}

