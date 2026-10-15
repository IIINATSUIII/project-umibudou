# Issue #57 実装と検証結果

確認日: 2026年10月15日（日本時間）

基点: main `c0188b7135a36ea3115bad6ac60dd87401787b6e`
関連: [Issue #57](https://github.com/IIINATSUIII/project-umibudou/issues/57)、[スタッフAPI認証 PR #72](https://github.com/IIINATSUIII/project-umibudou/pull/72)

## 実装内容

- スタッフAPIの7ルート・15操作で、本文解析・データ処理・ロックより前に共通認証を実行する。
- HS256・期限・非空のスタッフメールを検証し、無効JWTは401、署名鍵の設定不備は503で拒否する。スタッフのJSON応答はno-storeとする。
- setupは、認証済み・開発環境・明示的な有効化がそろう場合だけ実行できる。本番では有効化設定がtrueでも404となる。
- 公開予約・問診・QR、cronの独立した認証を維持する。画面とAPIの応答、公開パスの境界を分ける。
- Node.js 24 LTS、Next.js 16、React 19、ESLintのflat config、非同期paramsとNode.js proxyへ移行する。

## 採用した依存と構成

| 項目 | 採用版・変更 |
| --- | --- |
| Node.js | 24.21.0。既定のマシン環境を変更せず、一時キャッシュの実行ファイルでも検証した |
| Next.js / eslint-config-next | 16.4.1（10月14日公開のセキュリティ修正版） |
| React / React DOM | 19.3.1 |
| Next.js image optimizationのsharp | 0.35.5（SVG最適化RCEの修正要件を満たす） |
| qrcode.react | 4.2.0 |
| Vitest / Vite | 5.0.4 / 8.3.4。監査で検出されたテスト基盤のCriticalを解消するため更新 |
| Google APIs / Google Auth Library | 185.0.0 / 11.3.0。旧SDK経由のuuid等の監査指摘を解消するため更新 |
| ESLint | 9.39.4。Next.js公式構成に含まれるReact・import・a11yプラグインのpeer dependencyが9系までのため、10系を強制導入しない |
| 型チェック | `next typegen && tsc --noEmit`。新規checkoutでも生成型を用意してから検証 |
| ビルド | 既定のTurbopack。Cache ComponentsとReact Compilerは新たに有効化していない |

React Compiler向けの新しい`set-state-in-effect`ルールは、この移行では有効にしない。既存の読み込み・フォームリセットの動作を保つ。Rules of Hooks、依存配列の検証等は継続する。予約日の初期値は遅延初期化へ変更し、問診URLの画面遷移はNext.jsのrouterを使う。

## 実行結果

| 検証 | 結果 |
| --- | --- |
| 修正前の既存テスト | 229件すべて成功 |
| 認証追加前の回帰テスト | 認証・キャッシュ・設定不備の不足で失敗し、修正対象を検出 |
| 認証修正のテスト | 403件すべて成功 |
| クリーンインストール | `.nvmrc`のNode.js 24.21.0で`npm ci`成功 |
| 更新後のテスト | Node.js 24.21.0で22ファイル・405件すべて成功 |
| lint | 成功、エラー・警告なし |
| 型生成・型チェック | 成功 |
| 本番ビルド | Node.js 24.21.0 / Next.js 16.4.1 / Turbopackで成功 |
| HTTP検証 | 130リクエストすべて成功 |
| 依存監査 | production 0件。開発依存にHigh 7件・Moderate 2件、Critical 0件 |
| ブラウザー | ダミーアカウントのログイン、顧客一覧・詳細、名簿、ログアウト後の保護画面拒否、公開予約送信・QR描画・公開問診への遷移を確認。コンソールのerror / warnなし |
| PR #77のGitHub Actions | セキュリティ更新コミット `08c322a` で全ステップ成功（[実行結果](https://github.com/IIINATSUIII/project-umibudou/actions/runs/38660591733)） |

HTTP検証は、全15操作にCookieなし、不正JWT、署名済みの空メール、期限切れJWT、従来のmiddleware用ヘッダーとproxy用ヘッダーを付けて実行した。90件の拒否応答が401のJSON・no-storeであり、前後でJSON保存データが変わらないことを確認した。HEAD・未対応メソッド・OPTIONS、ログイン・ログアウト、認証済みでも本番でsetupが実行されないことも確認した。

公開フローでは、予約申込、スタッフの確定、問診URL発行、Cookieなしの問診参照・提出・再送、受付QR復元、スタッフの問診参照・チェックイン・名簿追加、入力URL失効を通した。cronはスタッフCookieだけでは拒否し、正しいBearerでもJSONストア構成では503となることを確認した。PostgreSQLでの成功処理はモックを使う独立したcronテストで確認した。

一時サーバーとダミーデータは検証終了後に片付けた。変更は専用worktreeで行い、元の作業ブランチにある別件の未コミット変更を保持した。本番へのデプロイ・データ移行は実施していない。

## 依存監査と残る確認

10月15日に更新後の依存を再監査した。`npm audit --omit=dev`はCritical / High / Moderateともに0件。全依存の監査はCritical 0件、High 7件、Moderate 2件が残る。残っているのは開発依存のbraces、micromatch、fast-glob、Tailwind CSS、Next.jsのlintプラグイン、PostCSS解析であり、本番依存には含まれない。

互換範囲内の修正は適用した。監査の自動修正案にはTailwind CSS 4へのメジャー移行やeslint-config-next 14への差し戻しが含まれるため、`--force`は使っていない。CSSの移行や上流依存の修正確認は別途検討する。ESLint 9はサポート終了の通知があり、公式プラグインの10系対応と合わせて追跡が必要である。

### 2026年10月14日追加セキュリティ更新

公式リリース [Next.js 16.4.1](https://github.com/vercel/next.js/releases/tag/v16.4.1) は、次の3件を修正する。いずれもNext.js 16.4.0が対象で、安定版16.4.1が修正版。

| 深刻度 | 勧告 | 影響 |
| --- | --- | --- |
| Critical | [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) | Cache Componentsで複数のtyped arrayを返す `use cache` 関数を使うアプリケーションでRCE |
| Critical | [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) | glibcベースLinux上のImage Optimizationで使われる依存ライブラリのRCE。Next.js更新でsharp 0.35.5以降が選ばれる |
| High | [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) | App RouterでServer Actionを使う場合、細工したリクエストが同一プロセスのCPUを占有するDoS |

公式の予告は[こちら](https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026)。npm公式レジストリのlatestとNext.jsの公式リリースが一致するNext.js 16.4.1、React / React DOM 19.3.1へ更新した。ロックされたsharp 0.35.5も確認した。更新後の405テスト、lint、型チェック、本番ビルド、130件のHTTP検証が成功した。

実際の本番ホスティング・OS・ヘッダー入口、本番またはテスト用Google Sheets / PostgreSQLとの接続、実機カメラによるQR読取は未確認。今回の実行確認は、自己ホストの使い捨てJSON環境と、既存のデータストア回帰テストの範囲である。
