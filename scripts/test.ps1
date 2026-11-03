<#
.SYNOPSIS
  Runs the BotForge test suite in three levels.

  unit         pure logic, no external services            (xUnit, pytest -m unit, Vitest, tsc)
  integration  each service against real Postgres/RabbitMQ (docker infra must be up)
  e2e          the running stack through the gateway       (pytest API journeys + Playwright browser)

.EXAMPLE
  ./scripts/test.ps1              # all levels (starts infra; e2e needs ./scripts/dev.ps1 start)
  ./scripts/test.ps1 unit
  ./scripts/test.ps1 integration
  ./scripts/test.ps1 e2e
#>
param([Parameter(Position = 0)][ValidateSet("all", "unit", "integration", "e2e")][string]$Level = "all")

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$results = [System.Collections.Generic.List[object]]::new()

function Run([string]$level, [string]$name, [string]$dir, [scriptblock]$cmd) {
    Write-Host ""
    Write-Host "=== [$level] $name" -ForegroundColor Cyan
    Push-Location (Join-Path $root $dir)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try { & $cmd; $ok = ($LASTEXITCODE -eq 0) } catch { Write-Host $_; $ok = $false } finally { Pop-Location }
    $results.Add([pscustomobject]@{ Level = $level; Suite = $name; Result = $(if ($ok) { "PASS" } else { "FAIL" }); Seconds = [int]$sw.Elapsed.TotalSeconds })
}

$dotnetTests = @(
    @{ Name = "identity (.NET)"; Dir = "services/identity-service/Identity.Tests" },
    @{ Name = "bots (.NET)";     Dir = "services/bot-service/Bots.Tests" },
    @{ Name = "gateway (.NET)";  Dir = "services/gateway/Gateway.Tests" }
)
$pyTests = @(
    @{ Name = "ingestion (Python)"; Dir = "services/ingestion-service" },
    @{ Name = "chat (Python)";      Dir = "services/chat-service" }
)

if ($Level -in "all", "unit") {
    foreach ($t in $dotnetTests | Where-Object { $_.Name -ne "gateway (.NET)" }) {
        Run "unit" $t.Name $t.Dir { dotnet test -nologo -v q --filter "Level=Unit" }
    }
    foreach ($t in $pyTests) { Run "unit" $t.Name $t.Dir { .venv/Scripts/python -m pytest -q -m unit -W ignore } }
    Run "unit" "widget (Vitest)" "apps/widget" { npx vitest run }
    Run "unit" "dashboard (type check)" "apps/dashboard" { npx tsc --noEmit }
}

if ($Level -in "all", "integration") {
    docker compose -f (Join-Path $root "infra/docker-compose.yml") up -d --wait 2>&1 | Out-Null
    foreach ($t in $dotnetTests) { Run "integration" $t.Name $t.Dir { dotnet test -nologo -v q --filter "Level=Integration" } }
    foreach ($t in $pyTests) { Run "integration" $t.Name $t.Dir { .venv/Scripts/python -m pytest -q -m integration -W ignore } }
}

if ($Level -in "all", "e2e") {
    $python = Join-Path $root "services/chat-service/.venv/Scripts/python.exe"
    & $python -m pip install -q -r (Join-Path $root "tests/e2e/requirements.txt") 2>&1 | Out-Null
    Run "e2e" "API journeys (pytest)" "tests/e2e" { & $python -m pytest -q -p no:cacheprovider -W ignore }
    Run "e2e" "browser (Playwright)" "tests/e2e-ui" {
        if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund 2>&1 | Out-Null; npx playwright install chromium 2>&1 | Out-Null }
        npx playwright test
    }
}

Write-Host ""
$results | Format-Table -AutoSize | Out-String | Write-Host
if ($results | Where-Object Result -eq "FAIL") { exit 1 }
