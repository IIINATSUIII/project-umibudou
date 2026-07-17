# 沖ダイブ・パートナー 開発環境セットアップ（Windows / PowerShell）
# 使い方: リポジトリ直下で  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "=== 沖ダイブ・パートナー セットアップ ===" -ForegroundColor Cyan

# 1. Node.js バージョン確認（Next.js 14 は Node 18.17 以上が必要）
$nodeVersion = (node --version) -replace "^v", ""
Write-Host "Node.js: v$nodeVersion"
$major = [int]($nodeVersion.Split(".")[0])
$minor = [int]($nodeVersion.Split(".")[1])
if ($major -lt 18 -or ($major -eq 18 -and $minor -lt 17)) {
    Write-Host "NG: Node.js 18.17 以上が必要です。https://nodejs.org からインストールしてください。" -ForegroundColor Red
    exit 1
}

# 2. 依存パッケージのインストール
Write-Host "`n--- npm ci（依存インストール）---" -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { Write-Host "npm ci に失敗しました" -ForegroundColor Red; exit 1 }

# 3. .env.local の作成（既存なら触らない）
if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.local.example" ".env.local"
    # SESSION_SECRET を自動生成して埋め込む
    $secret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    (Get-Content ".env.local") -replace "SESSION_SECRET=.*", "SESSION_SECRET=$secret" |
        Set-Content ".env.local" -Encoding utf8
    Write-Host "`n.env.local を作成し SESSION_SECRET を自動生成しました。" -ForegroundColor Green
    Write-Host "STAFF_CREDENTIALS（ログイン用メール:パスワード）を .env.local で編集してください。" -ForegroundColor Yellow
    Write-Host "Google Sheets は未設定でもモックデータで動作します。" -ForegroundColor Yellow
} else {
    Write-Host "`n.env.local は既に存在するためスキップしました。"
}

# 4. 型チェックで環境を検証
Write-Host "`n--- 型チェック ---" -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host "型チェックに失敗しました" -ForegroundColor Red; exit 1 }

Write-Host "`n=== セットアップ完了 ===" -ForegroundColor Green
Write-Host "起動: npm run dev  →  http://localhost:3000"
Write-Host "ログイン情報は .env.local の STAFF_CREDENTIALS を参照"
