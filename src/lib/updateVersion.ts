/** クロックの差・同一ミリ秒の更新でも保存済みバージョンより進める。 */
export function nextUpdatedAt(previous?: string, now = Date.now()): string {
  const previousTime = Date.parse(previous || '')
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now
  ).toISOString()
}
