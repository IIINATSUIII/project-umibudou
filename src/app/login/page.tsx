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
  const [inviteToken, setInviteToken] = useState('')
  const [inviteState, setInviteState] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'warning'>('success')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('registered') === '1') {
      setMode('login')
      if (params.get('mail') === 'sent') {
        setNotice('アカウントを作成し、登録したメールアドレスへ案内メールを送信しました。')
        setNoticeTone('success')
      } else {
        setNotice('アカウントは作成されましたが、案内メールを送信できませんでした。管理者に確認してください。')
        setNoticeTone('warning')
      }
    }
    const token = params.get('invite')
    if (!token) return
    setInviteToken(token)
    setInviteState('loading')
    setMode('register')
    setInviteLoading(true)
    fetch(`/api/auth/invitations/preview?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || '招待リンクが無効または期限切れです')
        setEmail(data.email || '')
        setInviteState('valid')
      })
      .catch((err: unknown) => {
        setInviteToken('')
        setInviteState('invalid')
        setError(err instanceof Error ? err.message : '招待リンクを確認できません')
      })
      .finally(() => setInviteLoading(false))
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
          ...(inviteToken ? { token: inviteToken } : { email }),
          displayName,
          password,
          passwordConfirmation,
        }),
      })
      const data = await response.json().catch(() => ({}))
      setLoading(false)
      if (!response.ok) {
        setError(data.error || 'アカウントを作成できませんでした')
        return
      }
      const mailStatus = data.mail?.sent === true
        ? 'sent'
        : data.mail?.reason === 'not_configured'
          ? 'not-configured'
          : 'send-failed'
      await refreshAuth()
      router.push(`/dashboard?registered=1&mail=${mailStatus}`)
      return
    }

    const ok = await login(email, password)
    setLoading(false)
    if (ok) {
      // AuthProvider はルートレイアウトで一度しかマウントされないため、
      // 遷移前にコンテキストを更新しないと user が null のまま /login に戻される
      await refreshAuth()
      router.push('/dashboard')
    } else {
      setError('メールアドレスまたはパスワードが正しくありません')
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

        {notice && <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${noticeTone === 'success' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{notice}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className={`rounded-lg text-sm px-3 py-2 ${inviteState === 'valid' ? 'bg-blue-50 text-blue-800' : inviteState === 'invalid' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
              {inviteState === 'loading'
                ? '招待リンクを確認中…'
                : inviteState === 'valid'
                  ? '招待リンクを確認しました。登録内容を入力してください。'
                  : inviteState === 'invalid'
                    ? '招待リンクは使えません。招待なしで新規登録できます。'
                    : '招待リンクなしでスタッフ登録できます。'}
            </div>
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
              readOnly={mode === 'register' && inviteState === 'valid'}
              required
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean-500 ${mode === 'register' && inviteState === 'valid' ? 'bg-gray-100' : ''}`}
            />
            {mode === 'register' && inviteLoading && <p className="text-xs text-gray-400 mt-1">招待を確認中…</p>}
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

