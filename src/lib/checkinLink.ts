/** 予約完了画面から /line-menu/checkin を開くためのリンク（予約番号と確認コードをURLに含める）。 */
export function buildCheckinPath(reservationId: string, reservationToken: string): string {
  const params = new URLSearchParams({ reservationId, token: reservationToken })
  return `/line-menu/checkin?${params.toString()}`
}

/** URLから予約番号と確認コードを取り出す。どちらかが欠けていれば null（手入力にする）。 */
export function readCheckinParams(
  params: Pick<URLSearchParams, 'get'>
): { reservationId: string; reservationToken: string } | null {
  const reservationId = (params.get('reservationId') ?? '').trim()
  const reservationToken = (params.get('token') ?? '').trim()
  if (!reservationId || !reservationToken) return null
  return { reservationId, reservationToken }
}
