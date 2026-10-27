'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

export type AuthUser = {
  email: string
  displayName?: string
  role?: 'admin' | 'staff'
}

/** undefined = 初期化中, null = 未ログイン */
type AuthState = AuthUser | null | undefined

type AuthContextValue = {
  user: AuthState
  /** サーバーにセッションを問い合わせて状態を更新する（ログイン/ログアウト後に呼ぶ） */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: undefined,
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState>(undefined)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await r.json()
      setUser(data.user?.email ? data.user : null)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    // サーバーに JWT クッキーを確認してユーザー情報を取得
    refresh()
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * ログイン状態を返す。
 * undefined = 初期化中, null = 未ログイン, string = ログイン済みメール
 */
export function useAuth(): string | null | undefined {
  const user = useContext(AuthContext).user
  return user === undefined ? undefined : user?.email ?? null
}

/** 権限を含む現在ユーザー情報を返す。 */
export function useAuthUser(): AuthUser | null | undefined {
  return useContext(AuthContext).user
}

/** 認証状態の再取得関数を返す（ログイン/ログアウト直後に呼ぶ） */
export function useAuthRefresh(): () => Promise<void> {
  return useContext(AuthContext).refresh
}

