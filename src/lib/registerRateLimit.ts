import { ipAddress } from '@vercel/functions'
import type { NextRequest } from 'next/server'

/**
 * 招待なしのスタッフ登録は誰でも呼べるため、登録の試行回数を制限する。
 * プロセス内メモリで数えるだけなので、複数インスタンス間では共有されない。
 *
 * - 全体の上限：送信元に関係なく、1時間に GLOBAL_LIMIT 回まで。ヘッダーを偽装しても超えられない。
 * - 送信元ごとの上限：信頼できる送信元IPが取れる場合だけ、1時間に PER_CLIENT_LIMIT 回まで。
 *
 * 入力エラーは数えない（呼び出し側で入力チェックを通った後に consumeRegistrationAttempt を呼ぶ）。
 */
const WINDOW_MS = 60 * 60 * 1000
const PER_CLIENT_LIMIT = 5
const GLOBAL_LIMIT = 30
const MAX_TRACKED_CLIENTS = 10_000

type Window = { count: number; startedAt: number }

const perClient = new Map<string, Window>()
let global: Window = { count: 0, startedAt: 0 }

function pruneExpired(now: number): void {
  for (const [key, state] of perClient) {
    if (now - state.startedAt >= WINDOW_MS) perClient.delete(key)
  }
  if (now - global.startedAt >= WINDOW_MS) global = { count: 0, startedAt: now }
}

/**
 * 送信元IP。Vercel は x-real-ip を接続元のアドレスで上書きするので信頼できる。
 * それ以外の環境では x-real-ip / x-forwarded-for をクライアントが自由に書けるため使わず、
 * 全体の上限だけで制限する。
 */
export function registrationClientKey(req: NextRequest): string | null {
  if (!process.env.VERCEL) return null
  return ipAddress(req)?.trim() || null
}

/** 試行を1回数える。全体または送信元ごとの上限に達していれば数えずに true を返す。 */
export function consumeRegistrationAttempt(clientKey: string | null, now = Date.now()): boolean {
  pruneExpired(now)
  if (global.count >= GLOBAL_LIMIT) return true

  const client = clientKey ? perClient.get(clientKey) : undefined
  if (client && client.count >= PER_CLIENT_LIMIT) return true

  global.count += 1
  if (client) {
    client.count += 1
  } else if (clientKey && perClient.size < MAX_TRACKED_CLIENTS) {
    // 追跡数が上限に達したら送信元ごとの記録はやめ、全体の上限だけで守る（全員を締め出さない）。
    perClient.set(clientKey, { count: 1, startedAt: now })
  }
  return false
}

/** テスト用 */
export function resetRegistrationAttempts(): void {
  perClient.clear()
  global = { count: 0, startedAt: 0 }
}
