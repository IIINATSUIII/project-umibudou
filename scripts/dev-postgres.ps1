# Start a local PostgreSQL container and run the app with PostgreSQL as its primary store.
# The password is entered for this process only; do not save it in the repository.
param(
    [switch]$MigrateOnly,
    [ValidateSet('json', 'sheets')][string]$ImportSource,
    [string]$LocalDataDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$previous = @{}
foreach ($name in @('POSTGRES_DEV_PASSWORD', 'DATABASE_URL', 'DATA_STORE', 'SHEETS_SYNC_ENABLED', 'LOCAL_DATA_DIR')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    if ($Apply -and -not $ImportSource) { throw '-Apply requires -ImportSource.' }
    if ($LocalDataDir -and $ImportSource -ne 'json') { throw '-LocalDataDir requires -ImportSource json.' }
    if ($ImportSource -eq 'json') {
        if (-not $LocalDataDir) { throw '-ImportSource json requires -LocalDataDir.' }
        $env:LOCAL_DATA_DIR = (Resolve-Path -LiteralPath $LocalDataDir).Path
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is required for local PostgreSQL development.'
    }
    if (-not $env:POSTGRES_DEV_PASSWORD) {
        $securePassword = Read-Host 'Local PostgreSQL password' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $env:POSTGRES_DEV_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
    if (-not $env:POSTGRES_DEV_PASSWORD) {
        throw 'A local PostgreSQL password is required.'
    }

    docker compose -f compose.dev.yml up -d --wait
    if ($LASTEXITCODE -ne 0) { throw 'Could not start local PostgreSQL.' }

    $encodedPassword = [uri]::EscapeDataString($env:POSTGRES_DEV_PASSWORD)
    Remove-Item Env:POSTGRES_DEV_PASSWORD
    $env:DATABASE_URL = "postgresql://postgres:${encodedPassword}@127.0.0.1:55432/oki_dive"
    $env:DATA_STORE = 'postgres'
    $env:SHEETS_SYNC_ENABLED = 'false'

    npm run db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed.' }

    if ($ImportSource) {
        $importArgs = @('run', 'db:import-legacy', '--', "--source=$ImportSource")
        if ($Apply) { $importArgs += '--apply' }
        & npm @importArgs
        if ($LASTEXITCODE -ne 0) { throw 'Legacy import failed.' }
    }

    if (-not $MigrateOnly -and -not $ImportSource) {
        npm run dev
        if ($LASTEXITCODE -ne 0) { throw 'Development server failed.' }
    }
} finally {
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
    Pop-Location
}
