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
    // timeDefinesは観測の時系列ではなく予報要素（その日の最高／最低）の発表時刻なので、
    // 日付でグルーピングしても「同じ要素が重複しているだけ」で実際には最低気温が
    // 提供されていない場合がある（その場合は最高と同値になる）。
    // そのためmin===maxの時は最低気温が取れていないとみなし「－」にする。
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

    // 週間予報（json[1]）には明示的なtempsMin/tempsMaxがあり、短期予報より素性が明確。
    // 短期予報が2日分しか配信しない明後日分も、週間予報側にあればここで補える。
    const weeklyTempSeries = json[1]?.timeSeries?.[1]
    const weeklyByDate = new Map<string, { min?: number; max?: number }>()
    if (weeklyTempSeries) {
      const weeklyDates: string[] = weeklyTempSeries.timeDefines
      const weeklyArea = weeklyTempSeries.areas[0]
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
      if (dayTemps && dayTemps.length > 0) {
        const max = Math.max(...dayTemps)
        const min = Math.min(...dayTemps)
        tempHigh = `${max}`
        tempLow = max !== min ? `${min}` : '－'
      }
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
