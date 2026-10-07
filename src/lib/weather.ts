import type { WeatherDay } from '@/types'

// 気象庁オープンデータ（沖縄地方 471000）
const JMA_URL = 'https://www.jma.go.jp/bosai/forecast/data/forecast/471000.json'

// MSG-16: 海況情報の取得失敗時にウィジェット側が判別・表示するためのメッセージ
export const WEATHER_ERROR_MESSAGE = '海況情報を取得できませんでした'

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

    // 短期予報の00時は翌日の最低、09時は最高を表す。
    // 発表当日の00時要素は最高の重複であり、最低として扱わない。
    // 値の大小や一致では判別しない（翌日の最高・最低が同値でも有効）。
    const tempSeries = timeSeries[2]
    const reportDate = (json[0].reportDatetime || weatherSeries.timeDefines[0]).slice(0, 10)
    const tempsByDate = new Map<string, { min?: number; max?: number }>()
    if (tempSeries) {
      const area = tempSeries.areas.find((a: { area?: { code?: string } }) => a.area?.code === '91197') || tempSeries.areas[0]
      tempSeries.timeDefines.forEach((dt: string, i: number) => {
        const raw = area.temps?.[i]
        if (raw === undefined || raw === null || String(raw).trim() === '') return
        const value = Number(raw)
        if (!Number.isFinite(value)) return
        const date = dt.slice(0, 10)
        const hour = dt.slice(11, 13)
        const temperatures = tempsByDate.get(date) || {}
        if (hour === '09') temperatures.max = value
        if (hour === '00' && date > reportDate) temperatures.min = value
        tempsByDate.set(date, temperatures)
      })
    }

    // 週間予報（json[1]）には明示的なtempsMin/tempsMaxがあり、短期予報より素性が明確。
    // 短期予報が2日分しか配信しない明後日分も、週間予報側にあればここで補える。
    const weeklyTempSeries = json[1]?.timeSeries?.[1]
    const weeklyByDate = new Map<string, { min?: number; max?: number }>()
    if (weeklyTempSeries) {
      const weeklyDates: string[] = weeklyTempSeries.timeDefines
      const weeklyArea = weeklyTempSeries.areas.find((a: { area?: { code?: string } }) => a.area?.code === '91197') || weeklyTempSeries.areas[0]
      weeklyDates.forEach((dt: string, i: number) => {
        // "今日"分はtempsMin/tempsMaxが空文字になっており、Number('')は0になってしまう
        // （NaNにならない）ため、空文字は変換前に未提供として弾く
        const minRaw = weeklyArea.tempsMin?.[i]
        const maxRaw = weeklyArea.tempsMax?.[i]
        const min = minRaw ? Number(minRaw) : NaN
        const max = maxRaw ? Number(maxRaw) : NaN
        weeklyByDate.set(dt.slice(0, 10), {
          min: Number.isNaN(min) ? undefined : min,
          max: Number.isNaN(max) ? undefined : max,
        })
      })
    }

    return dates.map((dt, i) => {
      const date = dt.slice(0, 10)
      const dayTemps = tempsByDate.get(date)
      const weekly = weeklyByDate.get(date)

      let tempHigh = '－'
      let tempLow = '－'
      if (dayTemps?.max !== undefined) tempHigh = String(dayTemps.max)
      if (dayTemps?.min !== undefined) tempLow = String(dayTemps.min)
      if (weekly?.max !== undefined) tempHigh = `${weekly.max}`
      if (weekly?.min !== undefined) tempLow = `${weekly.min}`

      return {
        date,
        weather: weathers[i] ?? '不明',
        wind: winds[i] ?? '－',
        wave: waves[i] ?? '－',
        tempHigh,
        tempLow,
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
        date: dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
        weather: WEATHER_ERROR_MESSAGE,
        wind: '－',
        wave: '－',
        tempHigh: '－',
        tempLow: '－',
        icon: '⚠️',
      }
    })
  }
}
