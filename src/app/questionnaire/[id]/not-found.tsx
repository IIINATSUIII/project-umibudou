export default function QuestionnaireNotFound() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <section className="max-w-md w-full bg-white rounded-xl border border-gray-200 p-6 text-center space-y-3">
        <div className="text-5xl">🔗</div>
        <h1 className="text-xl font-bold text-gray-800">このページは利用できません</h1>
        <p className="text-sm text-gray-600">
          問診票URLが無効、または有効期限が切れています。お手数ですがショップへお問い合わせください。
        </p>
      </section>
    </main>
  )
}
