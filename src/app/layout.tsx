import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/authContext'

export const metadata: Metadata = {
  title: '沖ダイブ・パートナー',
  description: 'ダイビングショップ運営支援アプリ',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
