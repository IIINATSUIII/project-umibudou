# 🤿 沖ダイブ・パートナー

ダイビングショップ運営支援 Web アプリ — Next.js 14 + JWT 認証 + Google Sheets

---

## クイックスタート（チームメンバー向け）

前提: **Node.js 18.17 以上**（`.nvmrc` 参照）と Git。

```bash
git clone <このリポジトリのURL>
cd oki-dive-partner

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Mac / Linux / WSL / Git Bash
bash scripts/setup.sh

npm run dev   # → http://localhost:3000
```

セットアップスクリプトは「依存インストール → `.env.local` 作成 → `SESSION_SECRET` 自動生成 → 型チェック」まで自動で行います。あとは `.env.local` の `STAFF_CREDENTIALS` に自分のログイン用メール:パスワードを設定するだけです。

**Google Sheets の設定は不要で開発を始められます** — 未設定の場合は `data/*.json` へのローカル保存＋モックデータで全画面が動作します。

詳しいセットアップ手順は [docs/07_MVP版セットアップ手順書.md](docs/07_MVP版セットアップ手順書.md) を参照してください。設計資料（要件定義書・基本設計書・DB設計・詳細設計・画面遷移図）は [docs/](docs/) に同梱しています。開発規約は [CLAUDE.md](CLAUDE.md) を参照してください。

Git / GitHub が初めてのメンバーは [docs/00_GitHub初心者ガイド.md](docs/00_GitHub初心者ガイド.md) から読んでください。

**AI（Claude Code 等）を使って開発するメンバーは、必ず [docs/06_AI開発ガイド.md](docs/06_AI開発ガイド.md) を先に読んでください**（プロジェクトへの設定方法・ブランチの切り方・AI への指示のコツ・禁止事項をまとめています）。

---

## 手動セットアップ

```bash
cd oki-dive-partner
npm install
cp .env.local.example .env.local   # 下記を参考に値を設定
npm run dev                         # → http://localhost:3000
```

---

## 環境変数の設定（`.env.local`）

### スタッフ認証（必須）

外部サービス不要。`.env.local` にメールとパスワードを直接書きます。

```env
# パイプ | で複数スタッフを追加可能
STAFF_CREDENTIALS=staff@okidive.com:your_password|admin@okidive.com:admin_pass

# JWT 署名キー（32バイト以上のランダム文字列）
SESSION_SECRET=replace_with_random_hex
```

`SESSION_SECRET` の生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 認証の仕組み

```
POST /api/auth  { email, password }
  → STAFF_CREDENTIALS と照合
  → 一致したら JWT を生成し HTTP-only Cookie（odp_session）にセット
  → Next.js Middleware がすべてのページリクエストで Cookie を検証
  → 無効なら /login にリダイレクト
```

ブラウザを閉じても 7 日間ログイン状態が維持されます（Cookie の maxAge）。

### Google Sheets API（オプション）

設定しない場合、API ルートはモックデータを返して動作します（ローカル開発向け）。

1. [Google Cloud Console](https://console.cloud.google.com) でプロジェクトを開く
2. **API とサービス → Google Sheets API** を有効化
3. **IAM → サービスアカウント**を作成 → 鍵を JSON でダウンロード
4. 対象スプレッドシートをサービスアカウントのメールに「編集者」で共有

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=1ABC...  # スプレッドシート URL に含まれる ID
GOOGLE_DATASTORE_LOCK_PROJECT_ID=your-lock-project
```

Sheetsへの書き込みはFirestoreの分散ロックを使用します。同じスプレッドシートを利用する全インスタンスで同じロックプロジェクトを指定してください。設定方法と障害復旧は [レビュー修正・移行手順](docs/reviews/2026-10-06-review-fixes.md) を参照してください。

### スプレッドシートの初期化・移行

```
POST http://localhost:3000/api/setup
```

スタッフとしてログインしたセッションでPOSTすると「予約」「問診票」「顧客台帳」「名簿」を初期化・移行します。既存シートは複製してバックアップし、ヘッダー名を使って全行を移行します。旧スキーマへの書き込みは移行完了まで拒否します。GETではデータを変更しません。運用開始前に上記の移行手順を確認してください。

### Google Forms予約の自動取込（任意）

Google Formの回答先を、`GOOGLE_SPREADSHEET_ID` で指定した同じスプレッドシートに設定し、回答タブ名を `.env.local` の `GOOGLE_FORM_RESPONSES_SHEET` に指定します（既定値は `フォームの回答 1`）。回答先を別ファイルにする場合は、フォーム回答ファイルのIDを `GOOGLE_FORM_SPREADSHEET_ID` に指定してください。

スタッフがダッシュボードまたは予約一覧を開くと、回答タブの新しい行を自動的に読み取り、`予約` シートへ `STS-01（予約受付）` として追加します。回答行から作った固定IDで重複取込を防ぎ、スタッフが「確定する」を押すと `STS-03（確定）` に更新されます。フォームの見出しが標準名（希望日・希望時間・コース・お名前・人数・電話番号・備考）と異なる場合は、`GOOGLE_FORM_HEADER_MAP` に対応関係をJSONで指定してください。

この方式はスタッフ画面の予約一覧取得時に同期するため、サーバー側の常駐ジョブやGASは不要ですが、スタッフ画面を開いていない間は次回の一覧取得時に取り込まれます。

---

## デプロイ（Vercel 推奨）

```bash
npx vercel
```

Vercel ダッシュボード → Settings → Environment Variables で以下を設定：

| 変数名 | 値 |
|---|---|
| `STAFF_CREDENTIALS` | `staff@okidive.com:pass\|staff2@okidive.com:pass2` |
| `SESSION_SECRET` | ランダム 32 バイト hex |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのメール |
| `GOOGLE_PRIVATE_KEY` | `"-----BEGIN PRIVATE KEY-----\n..."` |
| `GOOGLE_SPREADSHEET_ID` | スプレッドシート ID |

### GitHub Actions による自動チェック

`.github/workflows/ci.yml` により、`main` 向けのPull Requestと`main`へのpushで、次の処理を自動実行します。

1. `.nvmrc` に記載したNode.jsのセットアップ
2. `npm ci` による依存関係のインストール
3. `npm run lint` によるLint
4. `npm run typecheck` による型チェック
5. `npm run build` による本番ビルド確認

GitHubリポジトリの **Settings → Branches** で、`main`へのマージ条件にActionsのジョブ **Lint, typecheck, and build** を必須チェックとして追加すると、チェックに失敗した変更のマージを防止できます。

Vercelを利用する場合は、VercelプロジェクトのGitHub連携を有効にすると、`main`へのマージ後の本番デプロイも自動化できます。Vercelの環境変数はActionsに置かず、Vercel側で管理してください。

---

## ファイル構成

```
src/
├── app/
│   ├── api/
│   │   ├── auth/route.ts           ← POST ログイン / DELETE ログアウト / GET 現在ユーザー
│   │   ├── reservations/route.ts   ← 予約 CRUD（Google Sheets）
│   │   ├── questionnaires/route.ts ← 問診票 CRUD
│   │   ├── customers/route.ts      ← 顧客台帳 CRUD
│   │   └── setup/route.ts          ← バックアップ付きスキーマ移行（POST）
│   ├── login/                      ← ログイン画面
│   ├── dashboard/                  ← 予約サマリー + 海況
│   ├── reservations/               ← 予約一覧・登録
│   ├── questionnaire/[id]/         ← 問診票入力（ダイバー向け・認証不要）
│   ├── questionnaire/scan/         ← QR 読取（スタッフ向け）
│   └── customers/[id]/             ← 顧客詳細・ガイドメモ
├── lib/
│   ├── session.ts       ← JWT 生成・検証・認証情報照合（jose）
│   ├── authContext.tsx  ← Auth 状態管理（useAuth）
│   ├── auth.ts          ← login() / logout() クライアント関数
│   ├── sheets.ts        ← Google Sheets API クライアント（サーバーサイド）
│   ├── api.ts           ← クライアント側 fetch 関数
│   ├── mockData.ts      ← フォールバック用モックデータ
│   └── weather.ts       ← 気象庁オープンデータ（沖縄）
├── middleware.ts         ← Edge Middleware：JWT Cookie でルート保護
└── types/index.ts        ← 型定義
```

---

## データフロー

```
ブラウザ（React ページ）
  ↓ fetch("/api/reservations")  ※ Cookie 自動送信
Next.js API Route
  ↓ googleapis（サーバーサイドのみ）
Google Sheets（予約シート）
```

認証フロー：

```
POST /api/auth { email, password }
  → validateCredentials()（STAFF_CREDENTIALS 照合）
  → createSessionToken()（JWT 生成）
  → HTTP-only Cookie にセット（odp_session）

以降のリクエスト:
  → middleware.ts が Cookie を検証
  → 無効なら /login にリダイレクト
```
