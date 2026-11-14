<#
.SYNOPSIS
  Runs the whole BotForge stack locally.

.EXAMPLE
  ./scripts/dev.ps1 start     # infra (docker) + all services + dashboard
  ./scripts/dev.ps1 status
  ./scripts/dev.ps1 stop      # stops the app processes (infra keeps running)
  ./scripts/dev.ps1 stop -All # also stops the docker containers
  ./scripts/dev.ps1 start -DashboardPort 3001   # when another app already uses port 3000
#>
param(
    [Parameter(Position = 0)][ValidateSet("start", "stop", "status", "restart")][string]$Command = "start",
    [switch]$All,
    [switch]$NoBuild,
    [int]$DashboardPort = 3000
)

# native tools (docker, dotnet, npm) write progress to stderr; Windows PowerShell 5.1 would turn that
# into terminating errors under "Stop", so exit codes are checked explicitly instead
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root ".logs"
$pidFile = Join-Path $logs "pids.json"

$services = @(
    @{ Name = "identity";  Port = 5120; Health = "http://localhost:5120/health"; Dir = "services/identity-service/Identity.Api"; Exe = "dotnet"; Args = "run --no-build -c Release --launch-profile http" },
    @{ Name = "bots";      Port = 5215; Health = "http://localhost:5215/health"; Dir = "services/bot-service/Bots.Api";          Exe = "dotnet"; Args = "run --no-build -c Release --launch-profile http" },
    @{ Name = "ingestion"; Port = 0;    Health = $null;                          Dir = "services/ingestion-service";             Exe = ".venv/Scripts/python.exe"; Args = "-m app.worker" },
    @{ Name = "chat";      Port = 8000; Health = "http://localhost:8000/health"; Dir = "services/chat-service";                  Exe = ".venv/Scripts/python.exe"; Args = "-m uvicorn app.main:app --port 8000" },
    @{ Name = "gateway";   Port = 5000; Health = "http://localhost:5000/health"; Dir = "services/gateway/Gateway.Api";           Exe = "dotnet"; Args = "run --no-build -c Release --launch-profile http" },
    @{ Name = "dashboard"; Port = $DashboardPort; Health = "http://localhost:$DashboardPort/login"; Dir = "apps/dashboard"; Exe = "npm.cmd"; Args = "exec -- next start -p $DashboardPort" }
)

function Stop-Tree([int]$id) {
    # child processes first (dotnet run -> app, npm -> node)
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Tree $_.ProcessId }
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

function Test-OurProcess([int]$id) {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue).CommandLine
    return $cmd -and $cmd.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Stop-App {
    if (Test-Path $pidFile) {
        $pids = Get-Content $pidFile | ConvertFrom-Json
        foreach ($p in $pids.PSObject.Properties) { Stop-Tree ([int]$p.Value) }
        Remove-Item $pidFile -Force
    }
    # anything of ours still holding our ports (e.g. started by hand); never another project's process
    foreach ($s in $services | Where-Object { $_.Port -gt 0 }) {
        Get-NetTCPConnection -LocalPort $s.Port -State Listen -ErrorAction SilentlyContinue |
            Where-Object { Test-OurProcess $_.OwningProcess } |
            ForEach-Object { Stop-Tree $_.OwningProcess }
    }
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -match 'app\.worker|uvicorn app\.main' } |
        ForEach-Object { Stop-Tree $_.ProcessId }
    Write-Host "App processes stopped."
    if ($All) {
        docker compose -f (Join-Path $root "infra/docker-compose.yml") stop 2>&1 | Out-Null
        Write-Host "Docker containers stopped."
    }
}

# plain HttpClient without proxy auto-detection (Invoke-WebRequest in PowerShell 5.1 can stall on WPAD)
Add-Type -AssemblyName System.Net.Http
$script:http = New-Object System.Net.Http.HttpClient((New-Object System.Net.Http.HttpClientHandler -Property @{ UseProxy = $false }))
$script:http.Timeout = [TimeSpan]::FromSeconds(3)

function Test-Url([string]$url) {
    try {
        $r = $script:http.GetAsync($url).GetAwaiter().GetResult()
        return [int]$r.StatusCode -lt 500
    } catch { return $false }
}

function Wait-Healthy($s, [int]$seconds = 120) {
    if (-not $s.Health) { return $true }
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Url $s.Health) { return $true }
        Start-Sleep -Milliseconds 700
    }
    return $false
}

function Show-Status {
    foreach ($s in $services) {
        if (-not $s.Health) {
            $alive = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'app\.worker' }
            Write-Host ("{0,-10} {1}" -f $s.Name, $(if ($alive) { "running" } else { "DOWN" }))
            continue
        }
        $state = if (Test-Url $s.Health) { "up  " } else { "DOWN" }
        Write-Host ("{0,-10} {1}  {2}" -f $s.Name, $state, $s.Health)
    }
}

function Start-App {
    New-Item -ItemType Directory -Force $logs | Out-Null

    Write-Host "Starting infrastructure (docker compose)..."
    docker compose -f (Join-Path $root "infra/docker-compose.yml") up -d --wait 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed - is Docker Desktop running?" }

    if (-not $NoBuild) {
        Write-Host "Building .NET services, widget and dashboard..."
        foreach ($dir in "services/identity-service/Identity.Api", "services/bot-service/Bots.Api", "services/gateway/Gateway.Api") {
            dotnet build (Join-Path $root $dir) -c Release -nologo -v q | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Build failed: $dir" }
        }
        foreach ($dir in "apps/widget", "apps/dashboard") {
            Push-Location (Join-Path $root $dir)
            try {
                if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund 2>&1 | Out-Null }
                npm run build 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Build failed: $dir" }
            } finally { Pop-Location }
        }
    }

    foreach ($s in $services | Where-Object { $_.Port -gt 0 }) {
        $holder = Get-NetTCPConnection -LocalPort $s.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($holder) {
            $hint = if ($s.Name -eq "dashboard") { " Use -DashboardPort <port>, e.g. 3001." } else { "" }
            throw "Port $($s.Port) ($($s.Name)) is already used by process $($holder.OwningProcess).$hint"
        }
    }

    # the gateway only accepts dashboard calls from the dashboard's own address
    $env:Gateway__DashboardOrigins__0 = "http://localhost:$DashboardPort"
    # email links and the widget badge point at the local dashboard
    $env:App__DashboardUrl = "http://localhost:$DashboardPort"
    $env:BRANDING_URL = "http://localhost:$DashboardPort"
    # local only: let the website source read pages on this machine (e.g. the demo site); production blocks them
    $env:ALLOW_PRIVATE_SOURCES = "true"
    # messaging apps need a public https address for webhooks; locally only via a tunnel (cloudflared, ngrok):
    #   $env:PUBLIC_API_URL = "https://<your-tunnel>"; ./scripts/dev.ps1 restart
    if ($env:PUBLIC_API_URL) { $env:Channels__PublicUrl = $env:PUBLIC_API_URL }
    # end-to-end tests of messaging apps: a fake Telegram/Meta server run by tests/e2e (FAKE_PLATFORM_URL=http://localhost:5999)
    if ($env:FAKE_PLATFORM_URL) {
        $env:Channels__TelegramApi = $env:FAKE_PLATFORM_URL; $env:TELEGRAM_API = $env:FAKE_PLATFORM_URL
        $env:Channels__GraphApi = $env:FAKE_PLATFORM_URL; $env:GRAPH_API = $env:FAKE_PLATFORM_URL
        if (-not $env:PUBLIC_API_URL) { $env:Channels__PublicUrl = "http://localhost:5000" }
    }
    # identity calls the bot service (account deletion, monthly reports) with the bot service's internal key
    $botsSecrets = dotnet user-secrets list --project (Join-Path $root "services/bot-service/Bots.Api") 2>$null
    $internal = ($botsSecrets | Where-Object { $_ -like "Internal:ApiKey = *" }) -replace '^Internal:ApiKey = ', ''
    if ($internal) { $env:Internal__ApiKey = $internal }
    # admin page (http://localhost:<port>/admin): ADMIN_API_KEY from the environment, or a fixed local-only key
    $env:Admin__ApiKey = if ($env:ADMIN_API_KEY) { $env:ADMIN_API_KEY } else { "local-admin-key" }

    $pids = @{}
    foreach ($s in $services) {
        $dir = Join-Path $root $s.Dir
        $exe = if ($s.Exe -like ".venv*") { Join-Path $dir $s.Exe } else { $s.Exe }
        $p = Start-Process -FilePath $exe -ArgumentList $s.Args -WorkingDirectory $dir -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logs "$($s.Name).log") -RedirectStandardError (Join-Path $logs "$($s.Name).err.log")
        $pids[$s.Name] = $p.Id
        Write-Host ("Started {0,-10} (pid {1})" -f $s.Name, $p.Id)
    }
    $pids | ConvertTo-Json | Set-Content -Encoding utf8 $pidFile

    foreach ($s in $services) {
        if (Wait-Healthy $s) { Write-Host ("  {0,-10} ready" -f $s.Name) }
        else { Write-Warning "$($s.Name) did not become healthy - see .logs/$($s.Name).log" }
    }
    Write-Host ""
    Write-Host "Dashboard: http://localhost:$DashboardPort"
    Write-Host "Gateway:   http://localhost:5000 (widget at /widget.js)"
    Write-Host "RabbitMQ:  http://localhost:15672"
}

switch ($Command) {
    "start"   { Start-App }
    "stop"    { Stop-App }
    "restart" { Stop-App; Start-App }
    "status"  { Show-Status }
}
