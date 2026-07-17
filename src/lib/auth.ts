/**
 * 認証ユーティリティ（Firebase 不使用・JWT クッキー方式）
 * API ルート /api/auth を呼び出す。
 */

/** メールアドレス + パスワードでログイン */
export async function login(email: string, password: string): Promise<boolean> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })
  return res.ok
}

/** ログアウト（クッキー削除） */
export async function logout(): Promise<void> {
  await fetch('/api/auth', { method: 'DELETE', credentials: 'include' })
}
