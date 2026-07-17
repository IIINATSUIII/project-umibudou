import type { WeatherDay } from '@/types'

// 気象庁オープンデータ（沖縄地方 471000）
const JMA_URL = 'https://www.jma.go.jp/bosai/forecast/data/forecast/471000.json'

const WEATHER_ICONS: Record<string, string> = {
  '晴れ': '☀️',
  '晴': '☀️',
  '曇り': '☁️',
  '曇': '☁️',
  '雨': '🌧️',
  '雪': '❄️',
  '雷': '⛈️',
  '晴れ時々曇り': '🌤️',
  '晴時々曇': '🌤️',
  '曇り時々晴れ': '⛅',
  '曇時々晴': '⛅',
  '曇り時々雨': '🌦️',
  '曇時々雨': '🌦️',
}

function getIcon(weather: string): string {
  for (const [key, icon] of Object.entries(WEATHER_ICONS)) {
    if (weather.includes(key)) return icon
  }
  return '🌊'
}

export async function fetchWeather(): Promise<WeatherDay[]> {
  try {
    const res = await fetch(JMA_URL, { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error('fetch failed')
    const json = await res.json()

    const timeSeries = json[0]?.timeSeries
    if (!timeSeries) throw new Error('no data')

    // 天気（timeSeries[0]）
    const weatherSeries = timeSeries[0]
    const dates: string[] = weatherSeries.timeDefines.slice(0, 3)
    const weathers: string[] = weatherSeries.areas[0].weathers.slice(0, 3)
    const winds: string[] = weatherSeries.areas[0].winds.slice(0, 3)
    const waves: string[] = weatherSeries.areas[0].waves?.slice(0, 3) ?? ['－', '－', '－']

    return dates.map((dt, i) => ({
      date: dt.slice(0, 10),
      weather: weathers[i] ?? '不明',
      wind: winds[i] ?? '－',
      wave: waves[i] ?? '－',
      icon: getIcon(weathers[i] ?? ''),
    }))
  } catch {
    // APIエラー時はフォールバックデータを返す
    const today = new Date()
    return [0, 1, 2].map((d) => {
      const dt = new Date(today)
      dt.setDate(today.getDate() + d)
      return {
        date: dt.toISOString().slice(0, 10),
        weather: '取得失敗',
        wind: '－',
        wave: '－',
        icon: '🌊',
      }
    })
  }
}
