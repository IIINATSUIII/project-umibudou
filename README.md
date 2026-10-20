# 🤿 沖ダイブ・パートナー

ダイビングショップ運営支援 Web アプリ — Next.js 16 + JWT 認証 + Google Sheets

---

## クイックスタート（チームメンバー向け）

前提: **Node.js 24 LTS**（`.nvmrc` 参照）と Git。開発・CI・本番を24系にそろえてください。

```bash
git clone <このリポジトリのURL>
cd oki-dive-partner

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Mac / Linux / WSL / Git Bash
bash scripts/setup.sh

npm run dev   # → http://127.0.0.1:3030
```

セットアップスクリプトは「依存インストール → `.env.local` 作成 → `SESSION_SECRET` 自動生成 → 型チェック」まで自動で行います。DBを使わないローカル確認では `.env.local` の `STAFF_CREDENTIALS` に自分のログイン用メール:パスワードを設定できます。

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
npm run dev                         # → http://127.0.0.1:3030
```

---

## 環境変数の設定（`.env.local`）

### スタッフ認証（必須）

DB未接続のローカル確認では外部サービス不要です。`.env.local` の `STAFF_CREDENTIALS` は移行前の互換ログインとして利用します。開発環境でPostgreSQLが未起動の場合、登録したスタッフは`data/staff-users.json`へ保存されます。本番のスタッフ登録はPostgreSQLを使用します。

```env
# パイプ | で複数スタッフを追加可能
STAFF_CREDENTIALS=staff@okidive.com:your_password|admin@okidive.com:admin_pass

# JWT 署名キー（32バイト以上のランダム文字列）
SESSION_SECRET=replace_with_random_hex

# STAFF_CREDENTIALSからDBへ移行する最初の管理者
STAFF_ADMIN_EMAIL=admin@okidive.com
```

`SESSION_SECRET` の生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### スタッフ認証設定の書式とエラー

- `STAFF_CREDENTIALS` は `メール:パスワード` を `|` で区切って指定します。最初の `:` がメールとの区切りで、パスワード内の `:` は全体を照合します。`|` は区切り文字のためパスワードには使えません。
- 設定側のメール・パスワードの前後空白は除去します。入力したパスワードはそのまま照合します。
- 空エントリ、区切りがないエントリ、メール・パスワードが空のエントリは除外します。有効な組が0件ならログインAPIは503を返し、セッションを発行しません。
- 不正JSON、項目の省略・型不正・空文字・空白だけの入力は400、資格情報の不一致は401になります。失敗時にはセッションを新規発行しません。
- 正しい署名でもメールが空・欠落・型不正のJWTは拒否します。

旧実装ではパスワード内の2個目以降の `:` が切り捨てられていました。今後は設定したパスワード全体でログインしてください。

### スタッフアカウント

PostgreSQLを設定してからマイグレーションを実行すると、ログイン画面の「アカウント作成」からスタッフが招待なしで登録できます。管理者からメールアドレスと権限を指定して登録してもらう場合は、画面上の「スタッフ管理」から招待リンクを発行することもできます。

```bash
npm run db:migrate
```

初回だけ、`STAFF_CREDENTIALS` と `STAFF_ADMIN_EMAIL` に同じ既存管理者のメールアドレスを設定してログインしてください。ログイン成功時にそのアカウントはscryptハッシュ付きで `staff_users` へ移行され、以後はDBのアカウントを使用します。招待なしで登録したスタッフは、ログイン画面の「アカウント作成」からメールアドレス・氏名・5文字以上のパスワードを登録します。

- 招待リンクは24時間で期限切れになり、一度登録すると再利用できません。
- 登録画面からの自由なスタッフ登録ができます。招待なしで登録したアカウントは一般スタッフ権限になり、管理者が必要に応じて権限を変更できます。
- 管理者はスタッフの権限変更、停止・再開、招待の取消ができます。
- 最後に残った有効な管理者は停止・降格できません。
- メール送信はまだ行わず、管理画面で発行したリンクを安全な経路で共有します。
- `STAFF_CREDENTIALS` と `STAFF_ADMIN_EMAIL` は移行完了後に本番環境から削除してください。パスワードの平文をリポジトリへ保存しないでください。

実装の認証境界とAPI一覧は [スタッフ認証仕様](docs/security/staff-invite-auth.md) を参照してください。

### 認証の仕組み

```
POST /api/auth  { email, password }
  → staff_usersのscryptハッシュと照合（初回のみSTAFF_CREDENTIALSから移行）
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

この保守APIは `npm run dev` で起動した開発環境専用です。必要なバックアップと設定を確認し、`.env.local` の `ENABLE_SHEETS_SETUP=true` を明示的に設定してサーバーを再起動してください。ログイン後、同じブラウザーの開発者コンソールから `fetch('/api/setup', { method: 'POST' })` で実行できます。作業後は設定をfalseへ戻してください。

```
POST http://127.0.0.1:3030/api/setup
```

スタッフとしてログインしたセッションでPOSTすると、「予約」「問診票」「顧客台帳」「名簿」を初期化・移行します。既存シートは複製してバックアップし、ヘッダー名を使って全行を移行します。予約データでは `diveDate` を日付の正準フィールドとして扱い、旧 `date` / `course` / `phone` / `notes` 列も読み替えます。ステータスは旧文字列と `STS-01`〜`STS-06` を保存値のまま扱います。既存予約にはスタッフが予約一覧を開いた際に問診URL用トークンを発行します。移行後は旧スキーマへの書き込みが拒否されます。GETではデータを変更しません。更新前に保存した予約QRは問診ページを開けないため、新しい問診URLを参加者へ共有してください。運用開始前に [レビュー修正・移行手順](docs/reviews/2026-10-06-review-fixes.md) を確認してください。

**本番では `ENABLE_SHEETS_SETUP=true` でも実行できません。** 未認証は401、認証済みでも本番または無効設定なら404です。本番用Sheetsの保守は、バックアップを確認したうえで、設定を限定したローカルの開発環境から明示的に行ってください。

### スタッフAPIの認証

顧客・予約・問診・名簿・問診URL発行/失効・setupの全操作は、各ハンドラーの先頭で共通の `requireStaffSession()` を実行します。proxyが実行されなくても、未認証はデータ取得・更新・ロックの前に401のJSONで拒否します。署名鍵の設定不備は503です。個人情報を含むスタッフAPIの応答には `Cache-Control: no-store` を設定します。

公開予約・公開問診・受付QRにはスタッフのログインを要求せず、従来の予約トークン検証を維持します。cronは独立した `CRON_SECRET` のBearer認証で保護します。保護画面の未認証アクセスはログインへ誘導します。[認証仕様と検証](docs/security/staff-api-auth.md)

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
| `STAFF_ADMIN_EMAIL` | 初回移行する管理者メール |
| `DATABASE_URL` | PostgreSQL接続URL |
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
5. `npm test` による回帰テスト
6. `npm run build` による本番ビルド確認
7. `npm run test:security` による使い捨てJSONデータでのHTTP検証

GitHubリポジトリの **Settings → Branches** で、`main`へのマージ条件にActionsのジョブ **Lint, typecheck, and build** を必須チェックとして追加すると、チェックに失敗した変更のマージを防止できます。

Vercelを利用する場合は、VercelプロジェクトのGitHub連携を有効にすると、`main`へのマージ後の本番デプロイも自動化できます。Vercelの環境変数はActionsに置かず、Vercel側で管理してください。

---

## ファイル構成

```
src/
├── app/
│   ├── api/
│   │   ├── auth/route.ts           ← POST ログイン / DELETE ログアウト / GET 現在ユーザー
│   │   ├── auth/register/          ← 招待なし／招待リンクのスタッフ登録
│   │   ├── auth/invitations/       ← 管理者向け招待の作成・一覧・取消
│   │   └── auth/staff/             ← 管理者向けスタッフ権限・停止管理
│   │   ├── reservations/route.ts   ← 予約 CRUD（Google Sheets）
│   │   ├── questionnaires/route.ts ← 問診票 CRUD
│   │   ├── customers/route.ts      ← 顧客台帳 CRUD
│   │   └── setup/route.ts          ← バックアップ付きスキーマ移行（POST）
│   ├── login/                      ← ログイン / スタッフ登録画面
│   ├── staff/                      ← 管理者向けスタッフ管理画面
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
├── proxy.ts              ← Node.js Proxy：画面のログイン誘導とAPIの401応答
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
  → staff_usersのscryptハッシュ照合（初回のみSTAFF_CREDENTIALSから移行）
  → createSessionToken()（JWT 生成）
  → HTTP-only Cookie にセット（odp_session）

以降のリクエスト:
  → proxy.ts が Cookie を検証
  → スタッフAPIはハンドラーでも requireStaffSession() を実行
  → 無効ならAPIは401のJSON、画面は /login にリダイレクト
```

