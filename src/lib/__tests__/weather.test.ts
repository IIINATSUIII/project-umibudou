import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWeather } from '../weather'

const MSG_16 = '海況情報を取得できませんでした'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWeather', () => {
  it('取得に失敗した場合はMSG-16のフォールバックを返し、他の表示をブロックしない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await fetchWeather()

    expect(result).toHaveLength(3)
    for (const day of result) {
      expect(day.weather).toBe(MSG_16)
      expect(day.wind).toBe('－')
      expect(day.wave).toBe('－')
    }
  })

  it('APIがエラーレスポンス（not ok）を返した場合もMSG-16のフォールバックになる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    const result = await fetchWeather()

    expect(result.every((d) => d.weather === MSG_16)).toBe(true)
  })

  it('正常時は天気・風・波・気温をパースして返す', async () => {
    const jmaResponse = [
      {
        timeSeries: [
          {
            timeDefines: ['2026-07-28T11:00:00+09:00', '2026-07-29T00:00:00+09:00', '2026-07-30T00:00:00+09:00'],
            areas: [{ weathers: ['晴れ', '曇り', '雨'], winds: ['東の風', '北東の風', '南の風'], waves: ['1メートル', '1メートル', '1.5メートル'] }],
          },
          {},
          {
            timeDefines: ['2026-07-28T09:00:00+09:00', '2026-07-28T00:00:00+09:00', '2026-07-29T00:00:00+09:00', '2026-07-29T09:00:00+09:00'],
            areas: [{ temps: ['34', '34', '28', '32'] }],
          },
        ],
      },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => jmaResponse }))

    const result = await fetchWeather()

    // 当日分は予報要素(34)が重複しているだけで本当の最低気温ではないため「－」になる（レビューR15対応）
    expect(result[0]).toMatchObject({ date: '2026-07-28', weather: '晴れ', tempHigh: '34', tempLow: '－' })
    // 翌日分は最高/最低が異なる値なので、そのままmax/minとして採用される
    expect(result[1]).toMatchObject({ date: '2026-07-29', weather: '曇り', tempHigh: '32', tempLow: '28' })
    // 週間予報が無い場合、短期予報も無い3日目は取得できない
    expect(result[2]).toMatchObject({ date: '2026-07-30', weather: '雨', tempHigh: '－', tempLow: '－' })
  })

  it('週間予報の明示的なtempsMin/tempsMaxがあればそちらを優先する（3日目も補える）', async () => {
    const jmaResponse = [
      {
        timeSeries: [
          {
            timeDefines: ['2026-07-28T11:00:00+09:00', '2026-07-29T00:00:00+09:00', '2026-07-30T00:00:00+09:00'],
            areas: [{ weathers: ['晴れ', '曇り', '雨'], winds: ['東の風', '北東の風', '南の風'], waves: ['1メートル', '1メートル', '1.5メートル'] }],
          },
          {},
          {
            timeDefines: ['2026-07-28T09:00:00+09:00', '2026-07-28T00:00:00+09:00', '2026-07-29T00:00:00+09:00', '2026-07-29T09:00:00+09:00'],
            areas: [{ temps: ['34', '34', '28', '32'] }],
          },
        ],
      },
      {
        // 週間予報は"今日"分が空文字（未提供）、翌日以降は明示的なtempsMin/tempsMaxを持つ
        timeSeries: [{}, {
          timeDefines: ['2026-07-28T00:00:00+09:00', '2026-07-29T00:00:00+09:00', '2026-07-30T00:00:00+09:00'],
          areas: [{ tempsMin: ['', '26', '25'], tempsMax: ['', '31', '30'] }],
        }],
      },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => jmaResponse }))

    const result = await fetchWeather()

    // 今日分は週間予報が空文字（未提供）なので短期予報のフォールバック(34/－)のまま
    expect(result[0]).toMatchObject({ date: '2026-07-28', tempHigh: '34', tempLow: '－' })
    // 翌日分は週間予報の明示値を優先する
    expect(result[1]).toMatchObject({ date: '2026-07-29', tempHigh: '31', tempLow: '26' })
    // 3日目は短期予報には無いが、週間予報から補える
    expect(result[2]).toMatchObject({ date: '2026-07-30', tempHigh: '30', tempLow: '25' })
  })
})
