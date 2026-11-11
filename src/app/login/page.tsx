'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { login } from '@/lib/auth'
import { useAuthRefresh } from '@/lib/authContext'

export default function LoginPage() {
  const router = useRouter()
  const refreshAuth = useAuthRefresh()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [adminSetupAvailable, setAdminSetupAvailable] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  // 管理者が0人のときだけ、最初の管理者を作るための初期設定コード欄を出す。
  useEffect(() => {
    fetch('/api/auth/register', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => setAdminSetupAvailable(data?.adminSetupAvailable === true))
      .catch(() => setAdminSetupAvailable(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)
    if (mode === 'register') {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          displayName,
          password,
          passwordConfirmation,
          ...(adminSetupAvailable && setupCode.trim() ? { setupCode } : {}),
        }),
      })
      const data = await response.json().catch(() => ({}))
      setLoading(false)
      if (!response.ok) {
        setError(data.error || 'アカウントを作成できませんでした')
        return
      }
      if (data.admin) {
        // 初期設定コードで最初の管理者を作成した場合は、そのままログイン済みになる。
        await refreshAuth()
        router.push('/dashboard')
        return
      }
      // 承認前なのでログイン状態にはしない。ログインタブに戻して案内を出す。
      setMode('login')
      setPassword('')
      setPasswordConfirmation('')
      setDisplayName('')
      setShowPassword(false)
      setNotice('登録を受け付けました。管理者が承認するとログインできるようになります。')
      return
    }

    const result = await login(email, password)
    setLoading(false)
    if (result.ok) {
      // AuthProvider はルートレイアウトで一度しかマウントされないため、
      // 遷移前にコンテキストを更新しないと user が null のまま /login に戻される
      await refreshAuth()
      router.push('/dashboard')
    } else {
      setError(result.error || 'メールアドレスまたはパスワードが正しくありません')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-ocean-700 to-ocean-500 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🤿</div>
          <h1 className="text-xl font-bold text-gray-800">沖ダイブ・パートナー</h1>
          <p className="text-sm text-gray-500 mt-1">スタッフログイン</p>
        </div>

        <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-lg p-1 mb-5">
          <button type="button" onClick={() => { setMode('login'); setError(''); setNotice('') }} className={`rounded-md py-2 text-sm ${mode === 'login' ? 'bg-white shadow font-semibold text-ocean-700' : 'text-gray-500'}`}>
            ログイン
          </button>
          <button type="button" onClick={() => { setMode('register'); setError(''); setNotice('') }} className={`rounded-md py-2 text-sm ${mode === 'register' ? 'bg-white shadow font-semibold text-ocean-700' : 'text-gray-500'}`}>
            アカウント作成
          </button>
        </div>

        {notice && <p role="status" className="mb-4 rounded-lg px-3 py-2 text-sm bg-green-50 text-green-800">{notice}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <p className="rounded-lg text-sm px-3 py-2 bg-blue-50 text-blue-800">
              登録後、管理者が承認するとログインできるようになります。
            </p>
          )}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">氏名</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@okidive.com"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500"
            />
          </div>

          {mode === 'register' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード（確認）</label>
                <input type={showPassword ? 'text' : 'password'} value={passwordConfirmation} onChange={(e) => setPasswordConfirmation(e.target.value)} required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500" />
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} /> パスワードを表示
              </label>
              <p className="text-xs text-gray-400">5文字以上で設定してください。</p>
              {adminSetupAvailable && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                  <label htmlFor="setup-code" className="block text-sm font-medium text-amber-900 mb-1">初期設定コード（最初の管理者のみ）</label>
                  <input id="setup-code" type="password" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="off" className="w-full border border-amber-300 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500" />
                  <p className="text-xs text-amber-800 mt-1">管理者がまだ登録されていません。サーバーに設定した初期設定コードを入力すると、管理者として登録してすぐにログインできます。スタッフとして登録する場合は空欄のままにしてください。</p>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ocean-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-ocean-700 transition-colors disabled:opacity-50"
          >
            {loading ? (mode === 'register' ? '作成中…' : 'ログイン中…') : (mode === 'register' ? 'アカウントを作成' : 'ログイン')}
          </button>
        </form>

        <p className="mt-5 text-xs text-center text-gray-400">
          JWT セッション認証（HTTP-only Cookie）
        </p>
      </div>
    </div>
  )
}

