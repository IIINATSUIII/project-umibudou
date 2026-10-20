# スタッフ認証

## 方針

スタッフ登録は公開サインアップを基本とする。登録画面からメールアドレス・氏名・パスワードを入力すると、一般スタッフ（`staff`）として登録される。管理者が権限を指定したい場合だけ、一回限りの招待トークンを使える。招待にはメールアドレスと権限（`admin` / `staff`）を記録し、招待登録時に画面から権限を変更できないようにする。

公開登録で管理者権限は付与しない。`STAFF_ADMIN_EMAIL` に指定した初期管理者のメールアドレスは公開登録から予約し、`STAFF_CREDENTIALS` の初回ログインでDBへ移行する。

## データとセッション

- `staff_users` は `db/migrations/007_staff_auth.sql` で作成する。
- パスワードはNode.jsのscrypt（`N=131072, r=8, p=1`）でハッシュ化し、平文は保存しない。
- 招待トークンはSHA-256ハッシュだけをDBへ保存し、原文は作成時のレスポンスで一度だけ返す。
- JWTにはユーザーID・権限・セッション世代を含める。スタッフAPIは毎回DBの状態とセッション世代を再確認する。
- 停止・権限変更時にセッション世代を増やすため、既存Cookieも無効になる。
- CookieはHTTP-only、`SameSite=Lax`、本番では`Secure`とする。

## API

| API | 用途 | 認証 |
| --- | --- | --- |
| `POST /api/auth` | ログイン | 公開（DBユーザーまたは移行中の環境変数アカウント） |
| `GET /api/auth` | 現在のユーザー | Cookie |
| `POST /api/auth/register` | 招待なし／招待トークンのスタッフ登録 | 公開 |
| `GET /api/auth/invitations/preview` | 登録画面の招待確認 | 招待トークン |
| `GET/POST /api/auth/invitations` | 招待一覧・発行 | 管理者 |
| `DELETE /api/auth/invitations/:id` | 招待取消 | 管理者 |
| `GET/PATCH /api/auth/staff` | スタッフ一覧・権限/停止更新 | 管理者 |

登録完了メールはResendのHTTP API経由で送信する。`RESEND_API_KEY`と`EMAIL_FROM`が未設定でもアカウント作成は継続するが、APIレスポンスとログで未送信を示す。メールには登録メールアドレスとログインURLを含めるが、パスワードや招待トークンは含めない。招待リンク自体のメール自動送信は行わず、管理者が安全な経路で共有する。

## 初期管理者の移行

1. `DATABASE_URL`、`SESSION_SECRET`、`STAFF_CREDENTIALS`、`STAFF_ADMIN_EMAIL`を本番環境へ設定する。
2. `npm run db:migrate`を実行する。
3. `STAFF_ADMIN_EMAIL`と一致する`STAFF_CREDENTIALS`のアカウントで一度ログインする。
4. `staff_users`への移行を確認する。
5. 移行完了後、`STAFF_CREDENTIALS`と`STAFF_ADMIN_EMAIL`を本番環境から削除する。

本番環境ではDB未設定・DB接続障害時にスタッフ登録・スタッフ管理を503で無効にし、DB障害を空のスタッフ一覧として扱わない。開発環境ではDBが未起動でも、招待なしのスタッフ登録とログインに限り`data/staff-users.json`へフォールバックする。開発用JSONには本番データを置かない。

