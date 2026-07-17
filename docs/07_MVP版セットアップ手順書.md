# 07. MVP版セットアップ手順書

沖ダイブ・パートナー MVP 版（お店側＋お客様側）をローカルで動かすまでの手順書です。
所要時間の目安: **約10分**

---

## 1. MVP版の構成

1つの Next.js アプリに「お店側」と「お客様側」の両方の画面が含まれています。

| 区分 | URL | 認証 | 内容 |
|------|-----|------|------|
| お客様側 | `/booking` | 不要 | 予約申し込みフォーム |
| お客様側 | `/questionnaire/[id]` | 不要（QR経由） | 問診票の入力 |
| お店側 | `/login` | — | スタッフログイン |
| お店側 | `/dashboard` | 必要 | ダッシュボード（未確定申込・海況・今日の予約） |
| お店側 | `/reservations` | 必要 | 予約管理（確定・追加・一覧） |
| お店側 | `/customers` | 必要 | 顧客管理 |
| お店側 | `/questionnaire/scan` | 必要 | 問診票QRスキャン |

**Google Sheets の設定は不要で動きます。** 未設定の場合、データは `data/*.json` にローカル保存され、モックデータで全画面が動作します（MVP版はこのモードで十分です）。

---

## 2. 前提条件

- **Node.js 18.17 以上**（`node -v` で確認）
- **Git**

---

## 3. セットアップ手順

### 3-1. リポジトリを取得

```bash
git clone https://github.com/IIINATSUIII/project-umibudou.git
cd project-umibudou
```

### 3-2. セットアップスクリプトを実行

依存インストール → `.env.local` 作成 → `SESSION_SECRET` 自動生成 → 型チェック まで自動で行われます。

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# Mac / Linux / WSL / Git Bash
bash scripts/setup.sh
```

### 3-3. スタッフログイン情報を設定

`.env.local` を開き、`STAFF_CREDENTIALS` に自分のログイン用メール:パスワードを設定します。

```bash
# 書式: "メール:パスワード"（複数人は | 区切り）
STAFF_CREDENTIALS=staff@okidive.com:test1234
```

> `.env.local` は Git 管理外です。**絶対にコミットしないでください。**

### 3-4. 開発サーバーを起動

```bash
npm run dev
```

→ http://localhost:3000 が開けば成功です（ログイン画面にリダイレクトされます）。

---

## 4. 動作確認（お客様側 → お店側の一連の流れ）

1. **お客様側**: http://localhost:3000/booking を開き、希望日・コース・名前・人数・電話番号を入力して申し込む
2. **お店側**: http://localhost:3000/login で 3-3 で設定したメール・パスワードでログイン
3. ダッシュボードに「🔔 未確定の申し込み」として 1 の申し込みが表示されることを確認
4. 「✓ 確定する」を押すと予約として確定され、予約管理（/reservations）に反映される

ここまで動けばセットアップ完了です。

---

## 5. Google Sheets 連携（任意・本番運用時のみ）

MVP の動作確認には不要です。実データを Google Sheets に保存したい場合のみ、`.env.local` に以下を設定します。

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_sa@your_project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
```

- サービスアカウントの作成手順・シート構成は [03_基本設計書_DB設計編.md](03_基本設計書_DB設計編.md) を参照
- 未設定の間は自動的にローカル保存（`data/*.json`）にフォールバックします

---

## 6. トラブルシューティング

| 症状 | 対処 |
|------|------|
| `npm run dev` でエラー | Node.js のバージョンを確認（18.17 以上必須）。`node_modules` を削除して `npm install` をやり直す |
| ログインできない | `.env.local` の `STAFF_CREDENTIALS` の書式（`メール:パスワード`）を確認し、サーバーを再起動 |
| ポート 3000 が使用中 | `npm run dev -- -p 3001` で別ポートを指定 |
| 画面にデータが出ない | Sheets 未設定なら正常（モックデータ＋ `data/*.json` 保存で動作）。`data/` フォルダの中身を確認 |

---

## 7. 関連ドキュメント

- [00_GitHub初心者ガイド.md](00_GitHub初心者ガイド.md) — Git / GitHub が初めての人向け
- [01_要件定義書.md](01_要件定義書.md)
- [02_基本設計書.md](02_基本設計書.md)
- [05_画面遷移図.md](05_画面遷移図.md)
- [06_AI開発ガイド.md](06_AI開発ガイド.md) — AI（Claude Code 等）で開発する人は必読
