'use client'

const OKINAWA_LAT = 26.2124
const OKINAWA_LON = 127.6809

const WINDY_EMBED_URL = [
  'https://embed.windy.com/embed2.html',
  `?lat=${OKINAWA_LAT}`,
  `&lon=${OKINAWA_LON}`,
  `&detailLat=${OKINAWA_LAT}`,
  `&detailLon=${OKINAWA_LON}`,
  '&zoom=8',
  '&level=surface',
  '&overlay=wind',
  '&product=ecmwf',
  '&menu=true',
  '&message=true',
  '&marker=true',
  '&calendar=now',
  '&pressure=true',
  '&type=map',
  '&location=coordinates',
  '&detail=true',
  '&metricWind=kt',
  '&metricTemp=%C2%B0C',
  '&radarRange=-1',
].join('')

const WINDY_LINK = `https://www.windy.com/${OKINAWA_LAT}/${OKINAWA_LON}/8`

export default function WindyWidget() {
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-800">🗺️ Windy 海況マップ</h2>
            <span className="text-[10px] font-medium uppercase tracking-wide text-ocean-700 bg-ocean-50 border border-ocean-100 px-2 py-0.5 rounded-full">
              Live map
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            沖縄本島周辺の風・波・雨を地図で確認
          </p>
        </div>
        <a
          href={WINDY_LINK}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ocean-600 hover:text-ocean-700 underline underline-offset-2"
        >
          Windyで全画面表示 ↗
        </a>
      </div>

      <div className="bg-slate-100 p-2 sm:p-3">
        <div className="relative overflow-hidden rounded-lg bg-slate-200 aspect-[16/10] min-h-[280px] sm:min-h-0">
          <iframe
            title="Windy 沖縄本島の風況・海況マップ"
            src={WINDY_EMBED_URL}
            className="absolute inset-0 h-full w-full border-0"
            loading="lazy"
            allowFullScreen
          />
        </div>
      </div>

      <p className="px-4 py-3 text-xs text-gray-500">
        地図左上のメニューから「風」「波」「雨」などの表示を切り替えられます。
      </p>
    </section>
  )
}
