'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { logout } from '@/lib/auth'
import { useAuthRefresh } from '@/lib/authContext'

const links = [
  { href: '/dashboard',          label: '🏠 ダッシュボード' },
  { href: '/reservations',       label: '📅 予約管理' },
  { href: '/customers',          label: '👥 顧客台帳' },
  { href: '/questionnaire/scan', label: '📷 QR読取' },
]

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const refreshAuth = useAuthRefresh()

  async function handleLogout() {
    await logout()
    await refreshAuth()
    router.push('/login')
  }

  return (
    <nav className="bg-ocean-700 text-white">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
        <span className="font-bold text-lg tracking-tight">🤿 沖ダイブ・パートナー</span>

        <div className="hidden md:flex gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                pathname.startsWith(l.href)
                  ? 'bg-white/20 font-semibold'
                  : 'hover:bg-white/10'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <button
          onClick={handleLogout}
          className="text-sm text-white/70 hover:text-white transition-colors"
        >
          ログアウト
        </button>
      </div>

      {/* モバイル用ボトムナビ */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-ocean-700 flex z-50">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 py-3 text-center text-xs transition-colors ${
              pathname.startsWith(l.href) ? 'bg-white/20' : 'hover:bg-white/10'
            }`}
          >
            {l.label.split(' ')[0]}
            <div className="text-[10px] mt-0.5">{l.label.split(' ')[1]}</div>
          </Link>
        ))}
      </div>
    </nav>
  )
}
