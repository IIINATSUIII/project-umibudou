/**
 * 認証ユーティリティ（Firebase 不使用・JWT クッキー方式）
 * API ルート /api/auth を呼び出す。
 */

/** メールアドレス + パスワードでログイン。失敗時はサーバーのエラーメッセージを返す。 */
export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error?: string }> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  if (res.ok) return { ok: true }
  const data: unknown = await res.json().catch(() => null)
  const error = typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string'
    ? (data as { error: string }).error
    : undefined
  return { ok: false, error }
}

/** ログアウト（クッキー削除） */
export async function logout(): Promise<void> {
  await fetch('/api/auth', { method: 'DELETE', credentials: 'include' })
}
