'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SPECIES } from '@/lib/fish/classify'
import { sortNewestFirst, type CollectionEntry } from '@/lib/fish/collection'
import { CollectionStore, isCollectionSupported } from '@/lib/fish/collectionStore'
import {
  createFish,
  dropFood,
  facing,
  hitTest,
  spinScale,
  step,
  wobbleOffset,
  type Food,
  type SwimmingFish,
  type TankSize,
} from '@/lib/fish/aquariumSim'

/** 水槽に入れる魚の数の上限（描画を軽く保つため）。新しいものから入れる */
const MAX_IN_TANK = 24
const TANK_ASPECT = 1.25 // 縦 / 横

/** 水槽の中の1匹分の見た目（画像）。切り抜きがあれば切り抜き、なければ写真を丸い泡に包む */
interface Look {
  image: HTMLImageElement
  bubble: boolean
}

interface Bubble {
  x: number
  y: number
  r: number
  speed: number
}

const nameOf = (speciesId: number | null) => (speciesId === null ? 'わからない魚' : SPECIES[speciesId]?.ja ?? 'わからない魚')

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      resolve(image)
      // 画像は読み込み済みなので、URL は、すぐに解放してよい
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像を読み込めませんでした'))
    }
    image.src = url
  })
}

export default function AquariumPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [entries, setEntries] = useState<CollectionEntry[] | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const stateRef = useRef({
    fishes: [] as SwimmingFish[],
    foods: [] as Food[],
    looks: new Map<string, Look>(),
    names: new Map<string, string>(),
    bubbles: [] as Bubble[],
    label: null as { id: string; until: number } | null,
    nextFoodId: 1,
    tank: { width: 360, height: 450, floor: 56 } as TankSize,
    size: { cssWidth: 360, cssHeight: 450, ratio: 1 },
  })

  // ---- コレクションを読み込む（切り抜きを選んでいない・切り抜けなかった魚は、泡に包んで泳がせる） ----
  useEffect(() => {
    let cancelled = false
    const store = new CollectionStore()
    ;(async () => {
      if (!isCollectionSupported()) {
        setEntries([])
        return
      }
      try {
        const list = sortNewestFirst(await store.list()).slice(0, MAX_IN_TANK)
        if (!cancelled) setEntries(list)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '水槽を準備できませんでした。')
          setEntries([])
        }
      }
    })()
    return () => {
      cancelled = true
      void store.close()
    }
  }, [])

  // ---- 魚を水槽に入れる ----
  useEffect(() => {
    if (!entries) return
    let cancelled = false
    const state = stateRef.current
    ;(async () => {
      const random = Math.random
      const looks = new Map<string, Look>()
      const names = new Map<string, string>()
      for (const entry of entries) {
        try {
          const useSprite = entry.sprite instanceof Blob
          looks.set(entry.id, { image: await loadImage(useSprite ? (entry.sprite as Blob) : entry.photo), bubble: !useSprite })
          names.set(entry.id, nameOf(entry.speciesId))
        } catch {
          // 読み込めない写真は、水槽に入れない
        }
      }
      if (cancelled) return
      state.looks = looks
      state.names = names
      state.fishes = entries.filter((e) => looks.has(e.id)).map((e) => createFish(e.id, state.tank, random))
      state.foods = []
    })()
    return () => {
      cancelled = true
    }
  }, [entries])

  // ---- 大きさを、画面に合わせる ----
  const resize = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const cssWidth = Math.max(240, Math.floor(wrap.clientWidth))
    const cssHeight = Math.round(cssWidth * TANK_ASPECT)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(cssWidth * ratio)
    canvas.height = Math.round(cssHeight * ratio)
    canvas.style.height = `${cssHeight}px`
    const state = stateRef.current
    const before = state.tank
    state.tank = { width: cssWidth, height: cssHeight, floor: Math.round(cssHeight * 0.13) }
    state.size = { cssWidth, cssHeight, ratio }
    // 画面の大きさが変わったら、魚を新しい水槽の中に収める
    state.fishes = state.fishes.map((fish) => ({
      ...fish,
      x: Math.min(Math.max(fish.size / 2, (fish.x / before.width) * cssWidth), cssWidth - fish.size / 2),
      y: Math.min((fish.y / before.height) * cssHeight, cssHeight - state.tank.floor),
    }))
    state.bubbles = Array.from({ length: 14 }, () => ({
      x: Math.random() * cssWidth,
      y: Math.random() * cssHeight,
      r: 2 + Math.random() * 5,
      speed: 14 + Math.random() * 26,
    }))
  }, [])

  // ---- 描いて、動かす ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    resize()
    window.addEventListener('resize', resize)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const state = stateRef.current
    let frame = 0
    let last = performance.now()
    let running = true

    const draw = (now: number) => {
      const { cssWidth, cssHeight, ratio } = state.size
      const { tank } = state
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      // 水
      const water = context.createLinearGradient(0, 0, 0, cssHeight)
      water.addColorStop(0, '#7fd3e6')
      water.addColorStop(0.55, '#2b8fb8')
      water.addColorStop(1, '#0d4a73')
      context.fillStyle = water
      context.fillRect(0, 0, cssWidth, cssHeight)
      // 水面からの光
      context.save()
      context.globalAlpha = 0.1
      context.fillStyle = '#ffffff'
      for (let i = 0; i < 4; i++) {
        const x = ((i + 0.5) / 4) * cssWidth + Math.sin(now / 2600 + i * 1.7) * 26
        context.beginPath()
        context.moveTo(x - 14, 0)
        context.lineTo(x + 14, 0)
        context.lineTo(x + 70, cssHeight - tank.floor)
        context.lineTo(x - 30, cssHeight - tank.floor)
        context.closePath()
        context.fill()
      }
      context.restore()
      // 底の砂
      const sand = context.createLinearGradient(0, cssHeight - tank.floor, 0, cssHeight)
      sand.addColorStop(0, '#e6d3a1')
      sand.addColorStop(1, '#c9b27a')
      context.fillStyle = sand
      context.beginPath()
      context.moveTo(0, cssHeight - tank.floor + 10)
      for (let x = 0; x <= cssWidth; x += 20) context.lineTo(x, cssHeight - tank.floor + 6 + Math.sin(x / 38) * 6)
      context.lineTo(cssWidth, cssHeight)
      context.lineTo(0, cssHeight)
      context.closePath()
      context.fill()
      // 泡
      context.save()
      context.strokeStyle = 'rgba(255,255,255,0.55)'
      context.lineWidth = 1.2
      for (const bubble of state.bubbles) {
        context.beginPath()
        context.arc(bubble.x, bubble.y, bubble.r, 0, Math.PI * 2)
        context.stroke()
      }
      context.restore()
      // エサ
      context.fillStyle = '#d9a441'
      for (const food of state.foods) {
        context.beginPath()
        context.arc(food.x, food.y, 3.5, 0, Math.PI * 2)
        context.fill()
      }
      // 魚（泳ぐ向きに合わせて、左右を反転）
      for (const fish of state.fishes) {
        const look = state.looks.get(fish.id)
        if (!look) continue
        const { naturalWidth: w, naturalHeight: h } = look.image
        if (!w || !h) continue
        const scale = fish.size / Math.max(w, h)
        const dw = w * scale
        const dh = h * scale
        context.save()
        context.translate(fish.x, fish.y + wobbleOffset(fish))
        context.scale(facing(fish) * spinScale(fish), 1)
        if (look.bubble) {
          // 切り抜けなかった写真は、丸い泡に包む
          const radius = fish.size / 2
          context.beginPath()
          context.arc(0, 0, radius, 0, Math.PI * 2)
          context.save()
          context.clip()
          const cover = Math.max((radius * 2) / w, (radius * 2) / h)
          context.drawImage(look.image, (-w * cover) / 2, (-h * cover) / 2, w * cover, h * cover)
          context.restore()
          context.lineWidth = 3
          context.strokeStyle = 'rgba(255,255,255,0.75)'
          context.beginPath()
          context.arc(0, 0, radius, 0, Math.PI * 2)
          context.stroke()
          context.fillStyle = 'rgba(255,255,255,0.18)'
          context.beginPath()
          context.arc(-radius * 0.35, -radius * 0.4, radius * 0.22, 0, Math.PI * 2)
          context.fill()
        } else {
          context.drawImage(look.image, -dw / 2, -dh / 2, dw, dh)
        }
        context.restore()
      }
      // タップした魚の名前
      if (state.label && now < state.label.until) {
        const fish = state.fishes.find((f) => f.id === state.label?.id)
        const text = state.names.get(state.label.id)
        if (fish && text) {
          context.font = '600 13px system-ui, "Yu Gothic", sans-serif'
          const width = context.measureText(text).width + 18
          const x = Math.min(Math.max(width / 2 + 4, fish.x), cssWidth - width / 2 - 4)
          const y = Math.max(20, fish.y - fish.size / 2 - 14)
          context.fillStyle = 'rgba(255,255,255,0.92)'
          context.beginPath()
          context.roundRect(x - width / 2, y - 14, width, 24, 12)
          context.fill()
          context.fillStyle = '#0f3d5a'
          context.textAlign = 'center'
          context.fillText(text, x, y + 3)
        }
      }
    }

    const loop = (now: number) => {
      if (!running) return
      const dt = (now - last) / 1000
      last = now
      const result = step(state.fishes, state.foods, state.tank, dt, Math.random)
      state.fishes = result.fishes
      state.foods = result.foods
      for (const bubble of state.bubbles) {
        bubble.y -= bubble.speed * Math.min(dt, 0.1)
        bubble.x += Math.sin(now / 700 + bubble.r) * 0.2
        if (bubble.y < -10) {
          bubble.y = state.size.cssHeight - state.tank.floor
          bubble.x = Math.random() * state.size.cssWidth
        }
      }
      draw(now)
      frame = requestAnimationFrame(loop)
    }

    if (reduced) {
      // 「動きを減らす」設定: 動かさず、いまの様子を1回だけ描く（読み込みが終わるまで、少し待って描き直す）
      const timer = window.setInterval(() => draw(performance.now()), 600)
      draw(performance.now())
      return () => {
        running = false
        window.clearInterval(timer)
        window.removeEventListener('resize', resize)
      }
    }
    frame = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [resize])

  // ---- タップ: 魚なら名前、水ならエサ ----
  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const state = stateRef.current
    const hit = hitTest(state.fishes, x, y)
    if (hit) {
      state.label = { id: hit.id, until: performance.now() + 2200 }
      state.fishes = state.fishes.map((f) => (f.id === hit.id ? { ...f, spin: 0.6 } : f))
      setMessage(`${state.names.get(hit.id) ?? ''} をタップしました`)
      return
    }
    const before = state.foods.length
    state.foods = dropFood(state.foods, x, y, state.tank, state.nextFoodId++)
    setMessage(state.foods.length > before ? 'エサをまきました。魚が集まってきます。' : 'エサは、食べ終わってからまいてください。')
  }

  const fishCount = entries?.length ?? 0

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-7">
      <div className="mx-auto max-w-md">
        <Link href="/line-menu/fish/collection" className="text-sm font-medium text-teal-800 hover:underline">← コレクションへ</Link>
        <header className="mb-4 mt-5 text-center">
          <h1 className="text-2xl font-bold text-slate-900">🐠 マイ水槽</h1>
          <p className="mt-2 text-sm text-slate-600">撮った魚が、水槽を泳ぎます。魚をタップすると名前が、水をタップするとエサがまけます。</p>
        </header>

        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div ref={wrapRef} className="overflow-hidden rounded-2xl border-4 border-white bg-sky-200 shadow-lg">
          <canvas ref={canvasRef} onPointerDown={onPointerDown} data-testid="tank" aria-label="水槽。魚が泳いでいます" className="block w-full touch-manipulation select-none" />
        </div>

        <p role="status" data-testid="tank-message" className="mt-3 min-h-5 text-center text-sm text-slate-600">{message}</p>

        {entries !== null && fishCount === 0 && (
          <div className="mt-3 rounded-xl bg-white p-5 text-center text-sm text-slate-600 shadow-sm">
            <p>水槽には、まだ魚がいません。</p>
            <Link href="/line-menu/fish" className="mt-2 inline-block font-semibold text-sky-700 underline">おさかな図鑑で魚を撮って、コレクションに追加しましょう</Link>
          </div>
        )}
        {fishCount > 0 && (
          <p className="mt-2 text-center text-xs text-slate-500" data-testid="tank-count">
            水槽の魚: {fishCount}匹{fishCount >= MAX_IN_TANK ? `（新しい${MAX_IN_TANK}匹まで）` : ''}
          </p>
        )}
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-400">
          魚の切り抜きは、この端末の中だけで行います。うまく切り抜けなかった写真は、泡に包んで泳ぎます。切り抜きには、U²-Net（Apache License 2.0）を使っています。
        </p>
      </div>
    </main>
  )
}
