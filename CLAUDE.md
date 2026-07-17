# 沖ダイブ・パートナー — 開発ガイド（AI/人間共通）

ダイビングショップ運営支援 Web アプリ。予約集約・電子問診票（QR）・顧客台帳・海況表示を 1 画面に集約する MVP。

## 技術スタック

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- 認証: 独自 JWT（`jose`、HTTP-only Cookie `odp_session`、`src/middleware.ts` でルート保護）
- データストア: Google Sheets API（`googleapis`、サーバーサイドのみ）
  - **Sheets 未設定時は `data/*.json` へのローカル永続化＋モックデータで動作する**（`src/lib/localStore.ts` / `mockData.ts`）
- 外部 API: 気象庁オープンデータ（`src/lib/weather.ts`、沖縄の天気・波浪）

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（http://localhost:3000） |
| `npm run typecheck` | `tsc --noEmit` 型チェック |
| `npm run lint` | ESLint |
| `npm run build` | 本番ビルド |

セットアップは `scripts/setup.ps1`（Windows）/ `scripts/setup.sh`（Mac/Linux）。

## 設計資料

仕様の一次情報は `docs/` にある（Word 原本から変換した Markdown）：

- `docs/01_要件定義書.md` — 機能要件・問診票の入力項目一覧・セキュリティ要求
- `docs/02_基本設計書.md` — 画面・機能設計
- `docs/03_基本設計書_DB設計編.md` — シート（テーブル）定義・リレーション
- `docs/04_詳細設計書.md` — API・処理詳細
- `docs/05_画面遷移図.md`
- `docs/06_AI開発ガイド.md` — AI 開発初心者向けの手順・指示のコツ・禁止事項

機能追加・変更時はまず該当資料を確認すること。

## アーキテクチャの約束事

- Google Sheets へのアクセスは **必ず API Route（サーバーサイド）経由**。サービスアカウント鍵・`GOOGLE_PRIVATE_KEY` をクライアントコードに出さない。
- 環境変数は `.env.local`（コミット禁止）。新しい変数を追加したら `.env.local.example` と README も更新する。
- ダイバー（ゲスト）向け画面 `/questionnaire/[id]` は認証不要。それ以外のページは middleware で保護される。ルート保護の対象を変える場合は `src/middleware.ts` の matcher を確認。
- 問診票 URL の ID は推測困難なランダム ID を使うこと（要件定義書 §6）。
- `src/app/api/setup/route.ts` はシート初期化用。本番デプロイ前に削除する。

## 検証

変更後は最低限 `npm run typecheck` を通し、画面に関わる変更は `npm run dev` で実際に該当フローを操作して確認する（Sheets 未設定のモックモードで大半の動作確認が可能）。
