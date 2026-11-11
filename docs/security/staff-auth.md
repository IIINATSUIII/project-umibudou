# スタッフ認証

## 方針

スタッフ登録は招待なしで誰でも申請できる。ただし作成されるアカウントは権限 `staff` 固定・状態 `suspended` で、管理者がスタッフ管理画面で承認（`active` へ変更）するまでログインできない。登録APIは権限・状態の指定を受け付けない。

管理者権限は、既存の管理者がスタッフ管理画面で付与する。初期管理者は `STAFF_ADMIN_EMAIL` に指定したアカウントを `STAFF_CREDENTIALS` で初回ログインさせてDBへ移行する。

以前の招待リンク方式は廃止した。`staff_invitations` テーブルはマイグレーション履歴のため残しているが、アプリからは読み書きしない。

## データとセッション

- `staff_users` は `db/migrations/007_staff_auth.sql` で作成する。
- パスワードはNode.jsのscrypt（`N=131072, r=8, p=1`）でハッシュ化し、平文は保存しない。
- 承認待ちは「`suspended` かつ `last_login_at` が空」のアカウントとして画面に表示する。
- 登録APIは送信元IPごとに1時間5回までに制限する（プロセス内メモリ）。登録済みメールアドレスでも新規と同じ応答を返し、登録の有無を外部から判別できないようにする。
- 承認前はセッションCookieを発行しない。承認待ち・停止中のアカウントは、パスワードが正しい場合だけ403で理由を返し、誤りの場合は未登録と同じ401を返す。
- JWTにはユーザーID・権限・セッション世代を含める。スタッフAPIは毎回DBの状態とセッション世代を再確認する。
- 停止・権限変更時にセッション世代を増やすため、既存Cookieも無効になる。
- CookieはHTTP-only、`SameSite=Lax`、本番では`Secure`とする。

## API

| API | 用途 | 認証 |
| --- | --- | --- |
| `POST /api/auth` | ログイン | 公開（DBユーザーまたは移行中の環境変数アカウント） |
| `GET /api/auth` | 現在のユーザー | Cookie |
| `POST /api/auth/register` | スタッフ登録申請（`staff` / `suspended` で作成） | 公開（試行回数制限あり） |
| `GET/PATCH /api/auth/staff` | スタッフ一覧・承認・権限/停止更新 | 管理者 |

承認メールはResendのHTTP API経由で、管理者が承認したときだけ送信する。登録申請の時点では送らない（本人確認をしていない宛先へメールを送れてしまうため）。`RESEND_API_KEY`と`EMAIL_FROM`が未設定でも承認は完了するが、APIレスポンスとログで未送信を示す。メールには登録メールアドレスとログインURLを含めるが、パスワードは含めない。

## 初期管理者の移行

1. `DATABASE_URL`、`SESSION_SECRET`、`STAFF_CREDENTIALS`、`STAFF_ADMIN_EMAIL`を本番環境へ設定する。
2. `npm run db:migrate`を実行する。
3. `STAFF_ADMIN_EMAIL`と一致する`STAFF_CREDENTIALS`のアカウントで一度ログインする。
4. `staff_users`への移行を確認する。
5. 移行完了後、`STAFF_CREDENTIALS`と`STAFF_ADMIN_EMAIL`を本番環境から削除する。

本番環境ではDB未設定・DB接続障害時にスタッフ登録・スタッフ管理を503で無効にし、DB障害を空のスタッフ一覧として扱わない。スタッフ登録・承認にはDBが必要。開発用JSONには本番データを置かない。

