import Link from 'next/link'

const actions = [
  {
    href: '/booking',
    icon: '🗓️',
    title: 'ダイビングを予約する',
    description: '希望日やコースを選んで、予約を申し込みます。',
    color: 'bg-orange-500',
  },
  {
    href: '/line-menu/checkin',
    icon: '▦',
    title: 'チェックインQR',
    description: '予約情報を確認して、受付用QRを表示します。',
    color: 'bg-emerald-600',
  },
  {
    href: '/line-menu/fish',
    icon: '🐠',
    title: 'おさかな図鑑',
    description: '水中で撮った写真から、魚の候補を調べます。',
    color: 'bg-sky-600',
  },
]

export default function LineMenuPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-cyan-50 to-white px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-lg">
        <header className="mb-7 text-center">
          <p className="text-sm font-semibold tracking-[0.22em] text-teal-700">OKI DIVE PARTNER</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">海のサポートメニュー</h1>
          <p className="mt-2 text-sm text-slate-600">受付や、海で出会った魚を調べるときにご利用ください。</p>
        </header>
        <section aria-label="メニュー" className="grid gap-4">
          {actions.map((action, index) => (
            <Link key={action.href} href={action.href}
              className="group overflow-hidden rounded-2xl border-2 border-orange-400 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-teal-200">
              <div className="flex min-h-36 items-center gap-5 p-5 sm:p-6">
                <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl ${action.color} text-4xl text-white shadow-md`} aria-hidden="true">
                  {action.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-400 text-xs font-bold text-white">0{index + 1}</span>
                    <h2 className="text-lg font-bold text-slate-900">{action.title}</h2>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">{action.description}</p>
                </div>
                <span className="text-xl text-teal-700 transition group-hover:translate-x-1" aria-hidden="true">›</span>
              </div>
            </Link>
          ))}
        </section>
        <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">
          魚の判定は写真からの参考推定です。種類を断定できない場合は候補として表示します。
        </p>
      </div>
    </main>
  )
}
