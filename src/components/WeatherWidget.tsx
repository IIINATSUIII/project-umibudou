'use client'

import { useEffect, useState } from 'react'
import { fetchWeather } from '@/lib/weather'
import type { WeatherDay } from '@/types'

export default function WeatherWidget() {
  const [days, setDays] = useState<WeatherDay[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchWeather().then((d) => { setDays(d); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
        <div className="flex gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="flex-1 h-20 bg-gray-100 rounded-lg" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-500 mb-3">🌊 沖縄海況（気象庁）</h2>
      <div className="grid grid-cols-3 gap-3">
        {days.map((d, i) => (
          <div key={d.date} className={`rounded-lg p-3 text-center ${i === 0 ? 'bg-ocean-50 border border-ocean-200' : 'bg-gray-50'}`}>
            <div className="text-xs text-gray-500 mb-1">
              {i === 0 ? '今日' : i === 1 ? '明日' : '明後日'}
            </div>
            <div className="text-2xl mb-1">{d.icon}</div>
            <div className="text-xs font-medium text-gray-700 leading-tight mb-1">
              {d.weather.length > 12 ? d.weather.slice(0, 12) + '…' : d.weather}
            </div>
            <div className="text-xs text-gray-500">波 {d.wave}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
