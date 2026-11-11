'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/authContext'
import { staffLoginUrl } from '@/lib/staffLoginDestination'

export default function MobileCheckinPage() {
  const user = useAuth()
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const sendingRef = useRef(false)
  const mountedRef = useRef(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraSession, setCameraSession] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [sending, setSending] = useState(false)
  const [pendingToken, setPendingToken] = useState('')
  const [sentName, setSentName] = useState('')
  const [error, setError] = useState('')
  const [needsLogin, setNeedsLogin] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (user === null) router.replace(staffLoginUrl('/checkin/mobile'))
  }, [user, router])

  const send = useCallback(async (qrToken: string) => {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setPendingToken(qrToken)
    setError('')
    setSentName('')
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch('/api/checkin-handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrToken }),
        signal: controller.signal,
      })
      if (response.redirected || response.status === 401) {
        if (mountedRef.current) setNeedsLogin(true)
        throw new Error('ログインの有効期限が切れました。再ログインしてください。')
      }
      const body = await response.json().catch(() => {
        throw new Error('サーバーから送信結果を確認できませんでした。接続を確認して再送してください。')
      }) as { name?: string; error?: string }
      if (!response.ok) throw new Error(body.error || '送信できませんでした。')
      if (!body.name) throw new Error('送信結果を確認できませんでした。もう一度送信してください。')
      if (mountedRef.current) {
        setSentName(body.name)
        setPendingToken('')
      }
    } catch (cause) {
      if (mountedRef.current) setError(
        cause instanceof Error && cause.name !== 'AbortError'
          ? cause.message
          : '通信を確認できませんでした。接続を確認して再送してください。'
      )
    } finally {
      window.clearTimeout(timeout)
      sendingRef.current = false
      if (mountedRef.current) setSending(false)
    }
  }, [])

  useEffect(() => {
    if (!cameraOn || !user) return
    let active = true
    let detected = false
    let stream: MediaStream | undefined
    let controls: { stop(): void } | undefined
    const video = videoRef.current
    const stop = () => {
      controls?.stop()
      stream?.getTracks().forEach((track) => track.stop())
      if (video && stream && video.srcObject === stream) {
        video.pause()
        video.srcObject = null
      }
    }
    const hide = () => {
      if (document.hidden) {
        active = false
        stop()
        setCameraOn(false)
      }
    }
    document.addEventListener('visibilitychange', hide)
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('カメラを使うにはHTTPSで開いてください。利用できない場合はPCで手動検索してください。')
        }
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (!active || !video) return
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (!active) { stop(); return }
        controls = await new BrowserQRCodeReader().decodeFromStream(stream, video, (result, _error, readerControls) => {
          if (!active || detected || !result) return
          detected = true
          readerControls.stop()
          stream?.getTracks().forEach((track) => track.stop())
          setCameraOn(false)
          void send(result.getText())
        })
        if (!active || detected) { stop(); return }
        setCameraReady(true)
      } catch (cause) {
        stop()
        if (!active) return
        setCameraOn(false)
        setError(cause instanceof Error && cause.message.startsWith('カメラを使うには')
          ? cause.message
          : 'カメラを起動できませんでした。ブラウザーのカメラ権限を確認してください。')
      }
    }
    void start()
    return () => {
      active = false
      document.removeEventListener('visibilitychange', hide)
      stop()
    }
  }, [cameraOn, cameraSession, user, send])

  function startCamera() {
    setError('')
    setSentName('')
    setPendingToken('')
    setCameraReady(false)
    // ZXing can finish playback startup after cancellation, then clear its video
    // on stop(). Give each start its own element so old cleanup cannot affect it.
    setCameraSession((session) => session + 1)
    setCameraOn(true)
  }

  if (!user) return <main className="p-6 text-center text-gray-500">ログインを確認中…</main>

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md space-y-5">
        <Link href="/questionnaire/scan" className="text-sm text-ocean-700 underline">← PC受付・問診確認へ</Link>
        <header>
          <h1 className="text-2xl font-bold text-gray-800">店舗スマホ・QR読取</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">お客さんの受付QRを読み取ります。送信後、PCで問診を確認して名簿へ追加してください。</p>
        </header>
        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <video key={cameraSession} ref={videoRef} muted playsInline aria-label="QR読み取りカメラ" hidden={!cameraOn}
            className="aspect-square w-full rounded-xl bg-black object-cover" />
          {cameraOn && <p role="status" className="text-center text-sm text-gray-600">{cameraReady ? 'QRをカメラに向けてください' : 'カメラを起動中…'}</p>}
          {sending && <p role="status" className="text-center font-medium text-ocean-700">PCの受付待ち一覧へ送信中…</p>}
          {sentName && <div role="status" className="rounded-xl bg-green-50 p-4 text-green-800">
            <p className="font-bold">{sentName} 様</p>
            <p className="mt-1">PCへ送信しました</p>
            <p className="mt-2 text-sm">受付はまだ完了していません。PCの受付待ち一覧を確認してください。</p>
          </div>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
          {needsLogin ? <Link href={staffLoginUrl('/checkin/mobile')} className="block rounded-xl bg-ocean-600 px-4 py-3 text-center font-bold text-white">再ログインする</Link> : <>
            {pendingToken && !sending && <button type="button" onClick={() => void send(pendingToken)}
              className="w-full rounded-xl bg-ocean-600 px-4 py-3 font-bold text-white">同じQRを再送する</button>}
            <button type="button" disabled={sending} onClick={() => cameraOn ? setCameraOn(false) : startCamera()}
              className="w-full rounded-xl bg-ocean-700 px-4 py-3 font-bold text-white disabled:opacity-50">
              {cameraOn ? 'カメラを停止' : sentName || pendingToken ? '次のQRを読み取る' : 'カメラを起動'}
            </button>
          </>}
        </section>
        <p className="text-xs leading-relaxed text-gray-500">読み取れない場合は、PCのQR読取画面で氏名・電話番号から手動検索できます。店舗のPCとスマホは同じシステムにログインしてください。</p>
      </div>
    </main>
  )
}
