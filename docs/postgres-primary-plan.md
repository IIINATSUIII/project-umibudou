# PostgreSQL主保存先への移行計画

2026-10-28時点で本番運用はまだない。予約・問診・顧客・名簿・予約受付メールの主保存先をPostgreSQLとし、Google Sheetsは必要な場合だけ閲覧・集計用に同期する。ローカルJSONはDBを使わない開発用に残す。

## 1. 開発環境でPostgreSQLを起動する

WindowsではDocker Desktopを起動し、`powershell -ExecutionPolicy Bypass -File scripts\dev-postgres.ps1 -MigrateOnly`で開発用DBを起動・移行する。ほかの環境では`DATABASE_URL`を設定して`npm run db:migrate`を実行する。`db/migrations`の全ファイルが適用されたことを`schema_migrations`で確認する。`007`で始まる移行ファイルは2本あり、ファイル名全体が別のバージョンとして記録される。

## 2. 移行元とSheets同期の要否を決める

残したい開発データがSheets・ローカルJSONのどちらにあるか確認する。スタッフが引き続きSheetsを使う場合は、元シートをバックアップし、READMEの「スプレッドシートの初期化・移行」に従って開発環境のスタッフ認証付き`POST /api/setup`で必要なタブと現行ヘッダーを整える。旧スキーマのままではOutboxを配送できない。PostgreSQLへの取込より前に`SHEETS_SYNC_ENABLED=true`、Sheets認証情報と`CRON_SECRET`を設定し、初期化完了後に`/api/cron/sheets-outbox`の定期実行を準備する。Sheetsで直接編集した値はPostgreSQLへ戻らないため、予約などの更新はアプリで行う運用にする。

## 3. 既存の開発データを移行する

元データをバックアップし、WindowsのローカルDocker環境では`powershell -ExecutionPolicy Bypass -File scripts\dev-postgres.ps1 -ImportSource json -LocalDataDir <JSON保存先>`を実行する。Sheetsから取り込む場合は`-ImportSource sheets`を指定する。ほかの環境では接続先を設定して`npm run db:import-legacy -- --source=json|sheets`を実行する。これらのコマンドは変更せずに件数・参照・移行先の差分を調べる。予約、問診、顧客、名簿、予約受付メール、予約取消の追加項目を対象とする。問題が0件で、訪問回数の推定などの警告を確認してから、Windowsでは`-Apply`、ほかの環境では`--apply`を付けて移行する。JSON取込でSheets同期が有効な場合、顧客・予約・問診・名簿は同じトランザクションでOutboxに登録される。Sheetsからの取込では元シートに既に行がある。移行中は元データへの書き込みを止める。`data/staff-users.json`のスタッフはこの取込の対象外で、手順4で管理者を移行し、ほかのスタッフを再招待する。

同期を無効にして取込・運用した後で有効にする場合は、既存データのバックフィルを別途用意する。予約受付メールの送信状態はSheets同期の対象外。`sheets_outbox`の未処理・失敗件数を確認してから運用する。

## 4. アプリとスタッフ認証をPostgreSQLに切り替える

`DATA_STORE=postgres`を明示してアプリを起動する。この設定では`DATABASE_URL`がない場合、別の保存先へ自動で切り替わらず起動時にエラーになる。JSON保存のスタッフがいる場合は、READMEの手順どおり`STAFF_CREDENTIALS`と`STAFF_ADMIN_EMAIL`で最初の管理者を移行し、ほかのスタッフへ招待を発行する。予約の作成・更新、問診提出、顧客登録、名簿登録、受付メールの再試行を確認する。

## 5. 本番公開前に確認する

本番用の空のPostgreSQLに全移行ファイルを適用し、テストとビルドを通す。保存先をPostgreSQLに固定し、バックアップ・復元手順、Sheets同期と受付メール送信のcron、監視対象を確認する。本番データの移行・削除・公開は別途確認してから実施する。
