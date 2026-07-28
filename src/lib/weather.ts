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

    // 気温（timeSeries[2]、那覇＝天気の「本島中南部」に対応するアメダス地点）
    // 天気は3日分・timeDefinesが日付単位なのに対し、気温は当日/翌日の最高・最低が
    // 1日2件ずつ（=最大2日分）しか配信されないため、明後日分は取得できないことがある
    const tempSeries = timeSeries[2]
    const tempsByDate = new Map<string, number[]>()
    if (tempSeries) {
      const tempDates: string[] = tempSeries.timeDefines
      const temps: string[] = tempSeries.areas[0].temps
      tempDates.forEach((dt: string, i: number) => {
        const value = Number(temps[i])
        if (Number.isNaN(value)) return
        const date = dt.slice(0, 10)
        const list = tempsByDate.get(date) ?? []
        list.push(value)
        tempsByDate.set(date, list)
      })
    }

    return dates.map((dt, i) => {
      const date = dt.slice(0, 10)
      const dayTemps = tempsByDate.get(date)
      return {
        date,
        weather: weathers[i] ?? '不明',
        wind: winds[i] ?? '－',
        wave: waves[i] ?? '－',
        tempHigh: dayTemps ? `${Math.max(...dayTemps)}` : '－',
        tempLow: dayTemps ? `${Math.min(...dayTemps)}` : '－',
        icon: getIcon(weathers[i] ?? ''),
      }
    })
  } catch {
    // APIエラー時はMSG-16（海況情報を取得できませんでした）に沿ったフォールバックを返す
    const today = new Date()
    return [0, 1, 2].map((d) => {
      const dt = new Date(today)
      dt.setDate(today.getDate() + d)
      return {
        date: dt.toISOString().slice(0, 10),
        weather: '海況情報を取得できませんでした',
        wind: '－',
        wave: '－',
        tempHigh: '－',
        tempLow: '－',
        icon: '⚠️',
      }
    })
  }
}
