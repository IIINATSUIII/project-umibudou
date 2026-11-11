/** ログイン後の遷移先は受付画面の固定パスだけを許可する。URLやQR資格は引き継がない。 */
export function staffLoginDestination(next: string | null): string {
  return next === '/checkin/mobile' || next === '/questionnaire/scan' ? next : '/dashboard'
}

export function staffLoginUrl(pathname: string): string {
  const next = staffLoginDestination(pathname)
  return next === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}
