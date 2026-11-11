'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { login } from '@/lib/auth'
import { useAuthRefresh } from '@/lib/authContext'
import { staffLoginDestination } from '@/lib/staffLoginDestination'

export default function LoginPage() {
  const router = useRouter()
  const refreshAuth = useAuthRefresh()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const ok = await login(email, password)
      if (ok) {
      // AuthProvider はルートレイアウトで一度しかマウントされないため、
      // 遷移前にコンテキストを更新しないと user が null のまま /login に戻される
      await refreshAuth()
        router.replace(staffLoginDestination(new URLSearchParams(window.location.search).get('next')))
      } else {
        setError('メールアドレスまたはパスワードが正しくありません')
      }
    } catch {
      setError('ログインできませんでした。通信状態を確認して再度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-ocean-700 to-ocean-500 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🤿</div>
          <h1 className="text-xl font-bold text-gray-800">沖ダイブ・パートナー</h1>
          <p className="text-sm text-gray-500 mt-1">スタッフログイン</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="staff-email" className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              id="staff-email"
              autoComplete="username"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@okidive.com"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
            />
          </div>

          <div>
            <label htmlFor="staff-password" className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              id="staff-password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ocean-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-ocean-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <p className="mt-5 text-xs text-center text-gray-400">
          店舗のスタッフ用アカウントでログインしてください。
        </p>
      </div>
    </div>
  )
}
