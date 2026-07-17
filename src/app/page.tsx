'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/authContext'

export default function RootPage() {
  const user = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user === undefined) return // Firebase初期化中は待つ
    router.replace(user ? '/dashboard' : '/login')
  }, [user, router])

  return null
}
