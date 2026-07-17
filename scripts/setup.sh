#!/usr/bin/env bash
# 沖ダイブ・パートナー 開発環境セットアップ（Mac / Linux / WSL / Git Bash）
# 使い方: リポジトリ直下で  bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 沖ダイブ・パートナー セットアップ ==="

# 1. Node.js バージョン確認（Next.js 14 は Node 18.17 以上が必要）
node_version=$(node --version | sed 's/^v//')
echo "Node.js: v$node_version"
major=${node_version%%.*}
minor=$(echo "$node_version" | cut -d. -f2)
if [ "$major" -lt 18 ] || { [ "$major" -eq 18 ] && [ "$minor" -lt 17 ]; }; then
  echo "NG: Node.js 18.17 以上が必要です。https://nodejs.org からインストールしてください。" >&2
  exit 1
fi

# 2. 依存パッケージのインストール
echo ""
echo "--- npm ci（依存インストール）---"
npm ci

# 3. .env.local の作成（既存なら触らない）
if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
  secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  # macOS / GNU sed 両対応のため一時ファイル経由
  sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$secret/" .env.local > .env.local.tmp && mv .env.local.tmp .env.local
  echo ""
  echo ".env.local を作成し SESSION_SECRET を自動生成しました。"
  echo "STAFF_CREDENTIALS（ログイン用メール:パスワード）を .env.local で編集してください。"
  echo "Google Sheets は未設定でもモックデータで動作します。"
else
  echo ""
  echo ".env.local は既に存在するためスキップしました。"
fi

# 4. 型チェックで環境を検証
echo ""
echo "--- 型チェック ---"
npm run typecheck

echo ""
echo "=== セットアップ完了 ==="
echo "起動: npm run dev  →  http://localhost:3000"
echo "ログイン情報は .env.local の STAFF_CREDENTIALS を参照"
