'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { useAuthUser } from '@/lib/authContext'

type Staff = {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'staff'
  status: 'active' | 'suspended'
  lastLoginAt: string | null
}

/** 停止中で一度もログインしていないアカウントは、登録後の承認待ちとして扱う。 */
function isPendingApproval(member: Staff): boolean {
  return member.status === 'suspended' && member.lastLoginAt === null
}

export default function StaffPage() {
  const user = useAuthUser()
  const router = useRouter()
  const [staff, setStaff] = useState<Staff[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const response = await fetch('/api/auth/staff', { cache: 'no-store' })
    if (!response.ok) { setError('スタッフ管理を利用できません'); return }
    const data = await response.json()
    setStaff(data.staff ?? [])
  }

  useEffect(() => {
    if (user === undefined) return
    if (!user || user.role !== 'admin') { router.replace('/dashboard'); return }
    load().catch(() => setError('スタッフ情報を取得できません'))
  }, [user, router])

  async function updateStaff(id: string, patch: Partial<Pick<Staff, 'role' | 'status'>>) {
    setError(''); setMessage('')
    const response = await fetch('/api/auth/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { setError(data.error || 'スタッフを更新できません'); return }
    if (data.approved) {
      setMessage(data.mail?.sent
        ? '承認しました。本人へログインできる旨のメールを送信しました。'
        : '承認しました。メールは送信されていないため、本人へログインできることを伝えてください。')
    }
    await load()
  }

  if (user === undefined || !user || user.role !== 'admin') return <div className="min-h-screen flex items-center justify-center text-gray-400">読み込み中…</div>

  const pending = staff.filter(isPendingApproval)
  const registered = staff.filter((member) => !isPendingApproval(member))

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 space-y-6">
        <h1 className="text-xl font-bold text-gray-800">👤 スタッフ管理</h1>
        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {message && <p role="status" className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{message}</p>}

        <section className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-1">承認待ち（{pending.length}件）</h2>
          <p className="text-xs text-gray-500 mb-3">ログイン画面の「アカウント作成」から登録された人です。本人であることを確認してから承認してください。承認するとスタッフ権限でログインできるようになります。</p>
          {pending.length === 0 ? <p className="text-sm text-gray-400">承認待ちのアカウントはありません。</p> : <div className="divide-y">
            {pending.map((member) => <div key={member.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1"><p className="text-sm font-medium">{member.displayName}</p><p className="text-xs text-gray-500">{member.email}</p></div>
              <button onClick={() => updateStaff(member.id, { status: 'active' })} className="bg-ocean-600 text-white rounded-lg px-4 py-1.5 text-sm hover:bg-ocean-700">承認</button>
            </div>)}
          </div>}
        </section>

        <section className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3">登録済みスタッフ</h2>
          <div className="divide-y">
            {registered.map((member) => <div key={member.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="flex-1"><p className="text-sm font-medium">{member.displayName}</p><p className="text-xs text-gray-500">{member.email}</p></div>
              <select value={member.role} onChange={(e) => updateStaff(member.id, { role: e.target.value as Staff['role'] })} className="border rounded px-2 py-1 text-xs"><option value="staff">スタッフ</option><option value="admin">管理者</option></select>
              <button onClick={() => updateStaff(member.id, { status: member.status === 'active' ? 'suspended' : 'active' })} className="border rounded px-2 py-1 text-xs">{member.status === 'active' ? '停止' : '再開'}</button>
              <span className={`text-xs ${member.status === 'active' ? 'text-green-600' : 'text-gray-400'}`}>{member.status === 'active' ? '有効' : '停止中'}</span>
            </div>)}
          </div>
        </section>
      </main>
    </div>
  )
}
