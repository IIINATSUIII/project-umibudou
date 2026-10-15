# スタッフAPIの認証と保守API

関連: [Issue #57](https://github.com/IIINATSUIII/project-umibudou/issues/57)

## 認証の境界

スタッフ向けの7ルート・15操作は、ハンドラーの先頭で `requireStaffSession(req)` を実行する。JSON本文の解析、データ取得、Googleフォーム取込、ロック、書き込みより前に検証する。middlewareの実行済みヘッダーには依存しない。

| API | スタッフ認証が必要な操作 |
| --- | --- |
| `/api/customers` | GET / POST / PATCH |
| `/api/reservations` | GET / POST / PATCH |
| `/api/questionnaires` | GET / POST / PATCH |
| `/api/questionnaires/checkin` | POST |
| `/api/roster` | GET / POST |
| `/api/reservations/questionnaire-url` | POST / DELETE |
| `/api/setup` | POST |

JWTは既存のHTTP-only Cookie `odp_session`を使用する。HS256の署名、有効期限と非空文字列のメールを検証し、空・欠落・型不正の利用者情報は署名が正しくても拒否する。通常のログインで発行する7日間のセッションは維持する。

未認証・無効JWTは `401 { "error": "Unauthorized" }`、署名鍵の設定不備は `503 { "error": "AUTH_UNAVAILABLE" }`。無効なCookieは削除する。秘密値・JWT・リクエスト本文を認証エラーのログへ出力しない。スタッフAPIのJSON応答には `Cache-Control: no-store` を付ける。

`src/proxy.ts`で画面の未認証アクセスを `/login` へ誘導する。公開APIは `/api/public/` 配下、ログインAPIは `/api/auth` の完全一致で区分する。`/api/publicity`、`/api/auth-extra` 等を公開扱いにしない。`/questionnaire/scan` とその配下は保護する。公開リッチメニュー画像は `/line-rich-menu.png` の完全一致だけを例外とする。

公開予約・公開問診・QRの既存フローは、スタッフCookieなしで利用できる。問診・受付QRは既存の予約トークン、有効期限、予約状態、使用済み状態の検証を維持する。`/api/cron/sheets-outbox` は `CRON_SECRET` による独立したBearer認証を行う。

## Sheets初期化・移行

`POST /api/setup` は、スタッフ認証が成功し、`NODE_ENV=development` と `ENABLE_SHEETS_SETUP=true` がそろう場合だけ実行する。本番では有効化設定がtrueでも実行しない。GETによる初期化は提供しない。

1. 保守対象のSheetsとバックアップを確認する。
2. ローカルの `.env.local` に保守対象の接続設定と `ENABLE_SHEETS_SETUP=true` を設定する。
3. `npm run dev` で起動し、スタッフとしてログインする。
4. ブラウザーの開発者コンソールで `fetch('/api/setup', { method: 'POST' })` を実行し、応答とバックアップを確認する。
5. `ENABLE_SHEETS_SETUP=false` へ戻し、開発サーバーを停止または再起動する。

未認証は401、認証済みでも無効な環境・設定なら404。初期化の内部エラーは一般的な500のJSONを返し、Sheetsやドライバーの詳細を応答・ログへ出さない。

## 検証と変更時のルール

`staffApiAuth.test.ts` は、proxyを通さず全15操作を呼び出し、未認証・不正Cookie・迂回ヘッダー・不正JSON・空メールの署名済みJWTを拒否することと、データ処理が呼ばれないことを確認する。正常系は実際のjoseで署名したセッションを使う。

`staffAuth.test.ts` は、署名・期限・メール・アルゴリズム、Cookie、画面とAPIのパス境界、ログイン・ユーザー照会を確認する。`cronAuth.test.ts` と既存の公開問診テストで、スタッフ認証以外の入口を検証する。

APIを追加するときは、公開・認証・cron・スタッフのいずれかへ明示的に分類し、認証契約テストを更新する。スタッフ向けの新しい操作には認証前の処理がないことを確認する。

`npm run build` の後に `npm run test:security` を実行すると、本番サーバーをループバックへ一時起動し、ダミーの認証情報と独立したJSON保存先で130件のHTTP検証を行う。Google接続設定は空へ置き換え、`DATA_STORE=json`に固定する。本番データへ接続しない。終了時にサーバーと生成したダミーデータを片付ける。`--keep-server`を付けた場合は、ブラウザー確認後にEnterで終了する。

## フレームワークのセキュリティ更新

ハンドラー認証とNext.jsの更新は両方必要である。CVE-2025-29927の最低修正版14.2.25だけを最終更新先とはしない。サポート対象の正式版を採用し、lockfile、lint、型チェック、テスト、本番ビルドとHTTPの拒否応答を確認する。

2026年10月13日時点で公開済みのNext.js最新版は16.4.0。公式が予告している10月14日の追加セキュリティ更新では、影響範囲と修正版を改めて確認する。共通認証だけの変更でIssue #57を完了扱いにしない。[公式更新予告](https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026)、[サポートポリシー](https://nextjs.org/support-policy)、[CVE-2025-29927の勧告](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw)
