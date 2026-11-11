'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export default function MobileCheckinSetup() {
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState('')
  useEffect(() => {
    // localhostはスマホからPCを参照できず、HTTPではカメラが利用できない。
    const { protocol, hostname, origin } = window.location
    if (protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
      setUrl(`${origin}/checkin/mobile`)
    }
  }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied('URLをコピーしました。') }
    catch { setCopied('コピーできませんでした。下のURLを選択してコピーしてください。') }
  }

  return <details className="rounded-xl border bg-white p-4">
    <summary className="cursor-pointer font-semibold text-ocean-700">店舗スマホを準備する</summary>
    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-gray-700">
      <li>店舗スマホの標準カメラで、下の案内QRを読み取ります。</li>
      <li>スタッフ用アカウントでログインします。</li>
      <li>「カメラを起動」を押し、お客さんの受付QRを読み取ります。</li>
    </ol>
    {url ? <div className="mt-4 space-y-3">
      <div className="flex justify-center"><QRCodeSVG value={url} size={192} includeMargin level="M" aria-label="スタッフ用QR読取画面を開く案内QR" /></div>
      <p className="text-xs text-gray-600">このQRは読取画面への案内用です。スマホでもスタッフのログインが必要です。</p>
      <p className="break-all select-all text-sm text-gray-700">{url}</p>
      <button type="button" onClick={() => void copy()} className="rounded-lg border px-3 py-2 text-sm">スマホ用URLをコピー</button>
      <p role="status" className="text-xs text-gray-600">{copied}</p>
    </div> : <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">案内QRは店舗のHTTPSサイトで表示されます。ローカルPCのアドレスではスマホから利用できません。公開済みの店舗サイトでこの画面を開いてください。</p>}
    <p className="mt-3 text-xs text-gray-500">送信後はPCの「スマホからの受付待ち」で確認します。端末を変えても店舗内で同じ一覧を共有します。</p>
  </details>
}
