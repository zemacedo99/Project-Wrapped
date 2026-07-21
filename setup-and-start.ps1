#!/usr/bin/env pwsh
<#
.SYNOPSIS
    One-command setup and start for Project-Wrapped.

.DESCRIPTION
    Default (recommended) mode builds and runs the database AND the app
    entirely through Docker Compose over plain HTTP - only Docker is required
    on the host. The app is published directly on PORT (default 5000) and
    binds all interfaces (0.0.0.0), so other devices on the same network can
    open http://<this-machine-ip>:PORT. It validates prerequisites, prepares
    .env (generating secure local credentials on first run), starts the
    containers, waits for health checks, opens the Windows Firewall port when
    run as Administrator, and prints the URLs to open.

    Safe to re-run: it will not overwrite an existing .env, reuses existing
    containers/volumes, and never deletes data unless -ResetDatabase is
    passed (which additionally requires confirmation or -Force).

.PARAMETER Dev
    Local development mode instead of the default full-Docker deployment:
    starts only the database container, then runs the app on the host with
    `npm run dev` (hot reload). Requires Node.js/npm.

.PARAMETER Stop
    Stop the running containers (data is preserved) and exit.

.PARAMETER ResetDatabase
    Deletes the local database volume (ALL data). Requires typing "yes" to
    confirm, or pass -Force to skip the prompt (e.g. in automation).

.PARAMETER Force
    Skips the confirmation prompt for -ResetDatabase. Has no effect otherwise.

.PARAMETER SkipInstall
    In -Dev mode only: skip `npm install`.

.PARAMETER AdvertisedHost
    Overrides the IP address shown in the "Network:" URL printed at the end
    of setup (e.g. when auto-detection picks the wrong adapter - a VPN
    virtual adapter, WSL/Hyper-V/Docker virtual switch, etc). Only affects
    the displayed URL, never the address the server actually binds to
    (the server always binds 0.0.0.0, i.e. all interfaces). Can also be set
    via the ADVERTISED_HOST environment variable.

.PARAMETER Https
    Also start the optional Caddy reverse proxy (Compose "https" profile) to
    serve the app over HTTPS on -HttpsPort (default 443) using an internal,
    self-signed CA. Off by default: the plain-HTTP deployment needs no
    certificate installed on client machines and is the simplest reliable
    option for LAN access. Use -Https only if you specifically need TLS.

.PARAMETER HttpsPort
    Host port the Caddy reverse proxy publishes for HTTPS (default 443).
    Only used together with -Https. Change this if 443 is already in use by
    another service on this machine (IIS, another reverse proxy, VPN
    software, etc.) - the script detects and reports the conflict rather
    than silently picking a different port. Can also be set via the
    APP_HTTPS_PORT environment variable / .env.

.EXAMPLE
    .\setup-and-start.ps1
    Fresh clone or daily use: build/start the database + app in Docker over
    plain HTTP (reachable from other devices at http://<lan-ip>:5000).

.EXAMPLE
    .\setup-and-start.ps1 -Https
    Same, but also start the Caddy reverse proxy to serve HTTPS on port 443
    (self-signed internal CA - clients see a certificate warning until the
    root CA is installed; see README.md "HTTPS / internal CA").

.EXAMPLE
    .\setup-and-start.ps1 -Dev
    Local development with hot reload (Node.js required on the host).

.EXAMPLE
    .\setup-and-start.ps1 -Stop
    Stop the containers without deleting any data.

.EXAMPLE
    .\setup-and-start.ps1 -ResetDatabase
    Wipe the local database volume and start clean (asks for confirmation).

.EXAMPLE
    .\setup-and-start.ps1 -AdvertisedHost 10.53.220.71
    Force the displayed "Network:" URL to a specific address (e.g. the
    correct LAN IP when auto-detection picks a VPN/virtual adapter instead).

.EXAMPLE
    .\setup-and-start.ps1 -Https -HttpsPort 8443 -AdvertisedHost 10.8.220.73
    Use HTTPS on an alternative port (e.g. because 443 is already occupied by
    another service) together with a specific advertised address.
#>
[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Stop,
    [switch]$ResetDatabase,
    [switch]$Force,
    [switch]$SkipInstall,
    [switch]$Https,
    [string]$AdvertisedHost,
    [int]$HttpsPort
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
Set-Location $RepoRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "WARNING: $msg" -ForegroundColor Yellow }
function Fail($msg, [int]$Code = 1) {
    Write-Host "`nERROR: $msg" -ForegroundColor Red
    exit $Code
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Names that should never be echoed to the terminal.
$script:SecretPattern = "PASSWORD|SECRET|PAT$|_PAT|TOKEN|_KEY$"

function New-RandomSecret([int]$Length = 32) {
    $bytes = New-Object byte[] ($Length * 2)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $text = [Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', ''
    return $text.Substring(0, $Length)
}

$composeCmd = $null
function Get-ComposeCmd {
    if ($script:composeCmd) { return $script:composeCmd }
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        $script:composeCmd = @("docker", "compose")
    }
    elseif (Test-Command "docker-compose") {
        $script:composeCmd = @("docker-compose")
    }
    else {
        Fail "Docker Compose is not available. Update Docker Desktop (it bundles the 'docker compose' plugin) and re-run this script."
    }
    return $script:composeCmd
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory)][string[]]$ComposeArgs,
        [switch]$AllowFailure
    )
    $cmd = Get-ComposeCmd
    & $cmd[0] @($cmd[1..($cmd.Length - 1)] + $ComposeArgs)
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        Fail "docker compose $($ComposeArgs -join ' ') failed (exit code $code). See output above." $code
    }
    return $code
}

function Show-Diagnostics {
    Write-Host "`n--- docker compose ps ---" -ForegroundColor Yellow
    Invoke-Compose @("ps") -AllowFailure | Out-Null
    Write-Host "`n--- recent logs (last 50 lines per service) ---" -ForegroundColor Yellow
    Invoke-Compose @("logs", "--tail=50") -AllowFailure | Out-Null
}

function Test-PortFree([int]$Port) {
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    }
    catch {
        return $false
    }
}

function Get-LanIp {
    # Resolves the IP address to advertise in the "Network:" URL. Never
    # affects what the server actually binds to (always 0.0.0.0 / all
    # interfaces) - this only picks what to print for convenience.
    #
    # Precedence:
    #   1. -AdvertisedHost parameter
    #   2. ADVERTISED_HOST environment variable
    #   3. Auto-detect: the address of the interface that owns the default
    #      route, skipping loopback/APIPA/virtual adapters (Docker, WSL,
    #      Hyper-V, VMware/VirtualBox, VPN clients) where possible.
    #   4. Fallback: first remaining "Preferred" IPv4 address after the same
    #      exclusions, physical Ethernet/Wi-Fi adapters preferred.
    if ($AdvertisedHost) { return $AdvertisedHost }
    if ($env:ADVERTISED_HOST) { return $env:ADVERTISED_HOST }

    $virtualPattern = 'Virtual|VPN|vEthernet|WSL|Hyper-V|VMware|VirtualBox|Docker|Loopback|Tunnel|TAP|Npcap|Bluetooth'

    try {
        $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
            $_.IPAddress -ne "127.0.0.1" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -ne "WellKnown" -and
            $_.AddressState -eq "Preferred"
        }
    }
    catch { return $null }

    if (-not $candidates) { return $null }

    $physical = $candidates | Where-Object { $_.InterfaceAlias -notmatch $virtualPattern }

    # Prefer the interface that owns the lowest-metric default route, if it
    # survives the physical/virtual filter.
    try {
        $defaultRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
            Sort-Object RouteMetric | Select-Object -First 1
        if ($defaultRoute) {
            $onDefaultRoute = $physical | Where-Object { $_.InterfaceIndex -eq $defaultRoute.ifIndex } | Select-Object -First 1
            if ($onDefaultRoute) { return $onDefaultRoute.IPAddress }
        }
    }
    catch { }

    $preferred = $physical | Where-Object { $_.InterfaceAlias -match "Ethernet|Wi-?Fi" } | Select-Object -First 1
    if ($preferred) { return $preferred.IPAddress }
    if ($physical) { return ($physical | Select-Object -First 1).IPAddress }

    # Nothing survived the virtual-adapter filter (e.g. only a VPN adapter is
    # up) - fall back to any remaining candidate rather than showing nothing.
    return ($candidates | Select-Object -First 1).IPAddress
}

function Get-LanCandidates {
    # Lists every plausibly-reachable IPv4 address of THIS machine (physical LAN,
    # Wi-Fi and VPN), each tagged by kind, so the operator can pick the address
    # that is on the same network as the CLIENT. Purely informational - never
    # affects binding. A frequent support issue is pointing the browser at an
    # address that is not this host at all (e.g. an example IP from the docs),
    # so surfacing the real ones up front avoids that.
    try {
        $descByIndex = @{}
        Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { $descByIndex[$_.ifIndex] = $_.InterfaceDescription }
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
            $_.IPAddress -ne "127.0.0.1" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.AddressState -eq "Preferred" -and
            $_.InterfaceAlias -notmatch 'Loopback'
        } | ForEach-Object {
            $desc = [string]$descByIndex[$_.InterfaceIndex]
            $kind = if ($desc -match 'VPN|Fortinet|Barracuda|SSL|Tunnel|TAP') { 'VPN' }
                    elseif ($desc -match 'VMware|Hyper-V|WSL|Docker|VirtualBox|Virtual Ethernet') { 'virtual (usually NOT reachable by other machines)' }
                    else { 'physical LAN / Wi-Fi' }
            [PSCustomObject]@{ IPAddress = $_.IPAddress; Interface = $_.InterfaceAlias; Kind = $kind }
        } | Sort-Object @{E = { $_.Kind -notmatch 'physical' }}, IPAddress
    }
    catch { @() }
}

function Test-IsAdministrator {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PortOwnerDescription([int]$Port) {
    # Best-effort: identifies the process already listening on $Port, so a
    # conflict (e.g. IIS or another reverse proxy already on 443) can be
    # reported instead of silently picked around.
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        $names = $conns | ForEach-Object {
            $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) { "$($proc.ProcessName) (PID $($proc.Id))" } else { "PID $($_.OwningProcess)" }
        } | Select-Object -Unique
        if ($names) { return ($names -join ", ") }
    }
    catch { }
    return $null
}

function Register-FirewallRule([string]$RuleName, [int]$Port) {
    # Idempotent: creates the inbound allow rule for $Port on first run, and
    # leaves it alone (no duplicates) on subsequent runs. Scoped by Windows
    # Firewall profile only (Domain, Private) rather than a specific local
    # address, since the LAN/VPN-assigned address of this host can change
    # between reboots or VPN reconnects.
    $existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Ok "Firewall rule '$RuleName' already exists - leaving it as-is."
        return
    }

    if (-not (Test-IsAdministrator)) {
        Write-Warn "Not running as Administrator - cannot create the Windows Firewall rule automatically."
        Write-Host "   To allow other devices on the network to reach this app, run PowerShell as Administrator and execute:" -ForegroundColor Gray
        Write-Host "   New-NetFirewallRule -DisplayName '$RuleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private" -ForegroundColor Gray
        Write-Host "   NOTE: on a domain-managed machine the firewall may be Group-Policy controlled" -ForegroundColor Gray
        Write-Host "   (netsh advfirewall shows 'LocalFirewallRules: N/A (GPO-store only)'). If so, a local" -ForegroundColor Gray
        Write-Host "   rule is ignored and your IT/network team must allow inbound TCP $Port for this host." -ForegroundColor Gray
        return
    }

    try {
        New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $Port -Profile Domain, Private -ErrorAction Stop | Out-Null
        Write-Ok "Created firewall rule '$RuleName' (Domain/Private profiles, TCP $Port)."
    }
    catch {
        Write-Warn "Could not create firewall rule '$RuleName': $($_.Exception.Message)"
    }
}

function Format-BaseUrl([string]$HostName, [int]$Port) {
    if ($Port -eq 443) { return "https://$HostName" }
    return "https://${HostName}:$Port"
}

function Wait-ServiceHealthy([string]$Service, [int]$TimeoutSeconds = 90) {
    Write-Host "Waiting for '$Service' to become healthy (timeout ${TimeoutSeconds}s)..." -ForegroundColor Yellow
    $cmd = Get-ComposeCmd
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = & $cmd[0] @($cmd[1..($cmd.Length - 1)] + @("ps", "--format", "json", $Service)) 2>$null
        if ($status -match '"Health"\s*:\s*"healthy"') {
            return $true
        }
        if ($status -match '"State"\s*:\s*"exited"' -or $status -match '"State"\s*:\s*"restarting"') {
            # Give restarting containers a little grace before giving up early,
            # but don't wait the full timeout if the container keeps crashing.
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

Write-Host "Project-Wrapped Setup & Start" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Docker prerequisite checks (always required)
# ---------------------------------------------------------------------------
Write-Step "Checking Docker"

if (-not (Test-Command "docker")) {
    Fail "Docker is not installed or not in PATH. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and re-run this script."
}
Write-Ok "Docker CLI found: $(docker --version)"

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Docker daemon is not responding. Attempting to start Docker Desktop..."
    $dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerDesktop) {
        Start-Process $dockerDesktop | Out-Null
        Write-Host "Waiting for Docker Desktop to start (up to 90s)..." -ForegroundColor Yellow
        $started = $false
        for ($i = 0; $i -lt 45; $i++) {
            Start-Sleep -Seconds 2
            docker info *> $null
            if ($LASTEXITCODE -eq 0) { $started = $true; break }
        }
        if (-not $started) {
            Fail "Docker Desktop did not become ready in time. Start it manually, wait for the whale icon to say 'Docker Desktop is running', then re-run this script."
        }
    }
    else {
        Fail "Docker daemon is not running and Docker Desktop was not found at the default install path. Start Docker manually and re-run this script."
    }
}
Write-Ok "Docker daemon is running"

Get-ComposeCmd | Out-Null
Write-Ok "Docker Compose is available"

# ---------------------------------------------------------------------------
# -Stop: stop containers and exit (data preserved)
# ---------------------------------------------------------------------------
if ($Stop) {
    Write-Step "Stopping Project-Wrapped containers"
    Invoke-Compose @("stop")
    Write-Ok "Containers stopped. Data volume is preserved."
    Write-Host "Run '.\setup-and-start.ps1' again to restart, or 'docker compose down' to also remove the (stopped) containers." -ForegroundColor Gray
    exit 0
}

# ---------------------------------------------------------------------------
# .env file
# ---------------------------------------------------------------------------
Write-Step "Checking .env file"

$envFile = Join-Path $RepoRoot ".env"
$envExampleFile = Join-Path $RepoRoot ".env.example"

if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $envExampleFile)) {
        Fail ".env.example is missing from the repository. Cannot generate .env."
    }
    $content = Get-Content $envExampleFile -Raw
    # Replace the placeholder secrets with securely generated random values so
    # a fresh install never runs on a well-known default password.
    $content = $content -replace "POSTGRES_PASSWORD=password", "POSTGRES_PASSWORD=$(New-RandomSecret 24)"
    $content = $content -replace "SESSION_SECRET=dev-secret-key", "SESSION_SECRET=$(New-RandomSecret 48)"
    Set-Content -Path $envFile -Value $content -NoNewline
    Write-Ok "Created .env from .env.example with freshly generated local database credentials."
    Write-Host "   Edit .env later to add your Azure DevOps PAT or change other values." -ForegroundColor Gray
}
else {
    Write-Ok ".env already exists (leaving it untouched)"
}

# Load .env into the current process environment (without overwriting
# variables already set explicitly in the shell/session). Never echo secrets.
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)\s*=\s*(.*)\s*$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        if (-not (Test-Path "env:$key")) {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

foreach ($required in @("DATABASE_URL", "PORT", "POSTGRES_DB", "POSTGRES_USER")) {
    if (-not [Environment]::GetEnvironmentVariable($required)) {
        Fail "Required environment variable '$required' is not set. Check your .env file against .env.example."
    }
}
Write-Ok "Environment variables loaded"

$port = [int]([Environment]::GetEnvironmentVariable("PORT"))
if (-not $port) { $port = 5000 }
$pgPort = [int]([Environment]::GetEnvironmentVariable("POSTGRES_PORT"))
if (-not $pgPort) { $pgPort = 5432 }

# HTTPS port published by the Caddy reverse proxy (not used in -Dev mode).
# Precedence: -HttpsPort param > APP_HTTPS_PORT (env/.env) > 443 default.
$httpsPort = [int]([Environment]::GetEnvironmentVariable("APP_HTTPS_PORT"))
if ($HttpsPort) { $httpsPort = $HttpsPort }
if (-not $httpsPort) { $httpsPort = 443 }

# IP/hostname advertised to other devices. Only affects what's printed and
# what's passed to the Caddy container for logging - never how anything
# binds. Resolved now (rather than after containers start) so it can also be
# exported for docker compose variable interpolation below.
$advertisedHost = Get-LanIp
if (-not $advertisedHost) { $advertisedHost = "localhost" }

# Sanity check: warn loudly if the advertised address is not actually an IP of
# THIS machine. Pasting an example/other-host IP here is a common mistake and
# makes the printed "Network:" URL point at the wrong (or a foreign) device,
# which looks exactly like "the app won't open remotely".
try {
    $localIps = @((Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop).IPAddress)
    if ($advertisedHost -ne "localhost" -and $localIps -notcontains $advertisedHost) {
        Write-Warn "ADVERTISED_HOST '$advertisedHost' is NOT an address of this machine."
        Write-Host "   Other devices will not reach the app there. Leave ADVERTISED_HOST blank in .env to" -ForegroundColor Gray
        Write-Host "   auto-detect, or pass -AdvertisedHost with one of this host's real addresses (listed below)." -ForegroundColor Gray
    }
}
catch { }

[Environment]::SetEnvironmentVariable("ADVERTISED_HOST", $advertisedHost, "Process")
[Environment]::SetEnvironmentVariable("APP_HTTPS_PORT", $httpsPort, "Process")

# ---------------------------------------------------------------------------
# -ResetDatabase: destructive, requires confirmation
# ---------------------------------------------------------------------------
if ($ResetDatabase) {
    Write-Warn "This will PERMANENTLY DELETE the local database volume (all saved wrapped projects)."
    if (-not $Force) {
        $confirmation = Read-Host "Type 'yes' to continue, anything else to cancel"
        if ($confirmation -ne "yes") {
            Write-Host "Cancelled. No changes made." -ForegroundColor Yellow
            exit 0
        }
    }
    Write-Step "Resetting database"
    Invoke-Compose @("down", "-v")
    Write-Ok "Database volume removed. Continuing with a fresh setup..."
}

# ---------------------------------------------------------------------------
# Port availability (best-effort: skip if something we already manage is
# using it, e.g. a previous run of this same stack).
# ---------------------------------------------------------------------------
Write-Step "Checking port availability"
$alreadyUp = (Invoke-Compose @("ps", "--status", "running", "--format", "json") -AllowFailure) 2>$null
foreach ($p in @($port, $pgPort) | Select-Object -Unique) {
    if (-not (Test-PortFree $p)) {
        Write-Warn "Port $p appears to be in use. If that's this project already running, this is fine. Otherwise, stop whatever else is using port $p, or change PORT/POSTGRES_PORT in .env."
    }
}
if ($Https -and -not $Dev) {
    if (-not (Test-PortFree $httpsPort)) {
        $owner = Get-PortOwnerDescription $httpsPort
        $ownerText = if ($owner) { " (currently used by: $owner)" } else { "" }
        if ($owner -and $owner -notmatch "com\.docker|docker-proxy|vpnkit") {
            Write-Warn "Port $httpsPort appears to be in use by something other than this project's own containers$ownerText."
            Write-Host "   This is likely IIS, another reverse proxy, or VPN software already bound to $httpsPort." -ForegroundColor Gray
            Write-Host "   This script will NOT stop or replace it. Pick a free port instead, e.g.:" -ForegroundColor Gray
            Write-Host "   .\setup-and-start.ps1 -Https -HttpsPort 8443 -AdvertisedHost $advertisedHost" -ForegroundColor Gray
        }
        else {
            Write-Warn "Port $httpsPort appears to be in use$ownerText. If that's this project's own Caddy container already running, this is fine."
        }
    }
}
Write-Ok "Port check complete"

# ---------------------------------------------------------------------------
# Dev mode: run the app on the host (hot reload) with only the DB in Docker
# ---------------------------------------------------------------------------
if ($Dev) {
    if (-not (Test-Command "node")) {
        Fail "Node.js is not installed or not in PATH. Install Node.js 18+ from https://nodejs.org/ for -Dev mode, or omit -Dev to run everything in Docker instead."
    }
    $nodeVersion = (node --version) -replace "^v", ""
    if ([int]($nodeVersion.Split(".")[0]) -lt 18) {
        Fail "Node.js 18+ is required for -Dev mode (found v$nodeVersion)."
    }
    Write-Ok "Node.js v$nodeVersion"

    if (-not $SkipInstall) {
        Write-Step "Installing dependencies (npm ci)"
        if (Test-Path (Join-Path $RepoRoot "package-lock.json")) { npm ci } else { npm install }
        if ($LASTEXITCODE -ne 0) { Fail "npm dependency installation failed. See output above." }
        Write-Ok "Dependencies installed"
    }

    Write-Step "Starting database (Docker Compose)"
    Invoke-Compose @("up", "-d", "db")
    if (-not (Wait-ServiceHealthy "db" 90)) {
        Show-Diagnostics
        Fail "Database did not become healthy in time."
    }
    Write-Ok "Database is healthy"

    Write-Step "Applying database schema (drizzle-kit push)"
    npm run db:push
    if ($LASTEXITCODE -ne 0) { Fail "Applying the database schema failed. Confirm DATABASE_URL in .env matches the database started above." }
    Write-Ok "Schema is up to date"

    $lanIp = Get-LanIp
    Register-FirewallRule -RuleName "Project-Wrapped HTTP $port" -Port $port

    Write-Step "Starting application (development mode, hot reload)"
    Write-Host "Local:   http://localhost:$port" -ForegroundColor Cyan
    if ($lanIp) { Write-Host "Network: http://${lanIp}:$port" -ForegroundColor Cyan }
    Write-Host "Press Ctrl+C to stop the server`n" -ForegroundColor Gray
    npm run dev
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Default: full Docker Compose deployment (database + containerised app) over
# plain HTTP. The app is published directly on $port and binds 0.0.0.0, so
# other devices on the LAN can reach http://<lan-ip>:$port. Pass -Https to
# additionally start the Caddy reverse proxy for TLS on $httpsPort.
# ---------------------------------------------------------------------------
if ($Https) {
    Write-Step "Building and starting containers with HTTPS (docker compose --profile https up -d --build)"
    Invoke-Compose @("--profile", "https", "up", "-d", "--build")
}
else {
    Write-Step "Building and starting containers (docker compose up -d --build)"
    Invoke-Compose @("up", "-d", "--build")
}

if (-not (Wait-ServiceHealthy "db" 90)) {
    Show-Diagnostics
    Fail "Database did not become healthy in time."
}
Write-Ok "Database is healthy"

if (-not (Wait-ServiceHealthy "app" 120)) {
    Show-Diagnostics
    Fail "Application container did not become healthy in time. Run 'docker compose logs app' to investigate."
}
Write-Ok "Application is healthy"

if ($Https) {
    if (-not (Wait-ServiceHealthy "caddy" 60)) {
        Show-Diagnostics
        Fail "Reverse proxy (Caddy) did not become healthy in time. Run 'docker compose logs caddy' to investigate."
    }
    Write-Ok "Reverse proxy is healthy"

    Register-FirewallRule -RuleName "Project-Wrapped HTTPS $httpsPort" -Port $httpsPort

    $scheme = "https"
    $accessPort = $httpsPort
    $localUrl = Format-BaseUrl 'localhost' $httpsPort
    $networkUrl = Format-BaseUrl $advertisedHost $httpsPort
}
else {
    Register-FirewallRule -RuleName "Project-Wrapped HTTP $port" -Port $port

    $scheme = "http"
    $accessPort = $port
    $localUrl = "http://localhost:$port"
    $networkUrl = "http://${advertisedHost}:$port"
}

Write-Host "`nProject-Wrapped is running." -ForegroundColor Green
Write-Host ""
Write-Host "Local:   $localUrl" -ForegroundColor Cyan
Write-Host "Network: $networkUrl  <-- open this from the other PC" -ForegroundColor Cyan
if ($advertisedHost -eq "localhost") {
    Write-Warn "Could not auto-detect this machine's LAN IP. Find it with 'ipconfig' (IPv4 Address) and open ${scheme}://<that-ip>:$accessPort from the other PC."
}

# List all real addresses of this host so the operator can hand the client the
# one on the SAME network. Publishing (Docker) is on 0.0.0.0, so the app answers
# on every address below - but whether a given CLIENT can reach a given address
# depends on that client's network (LAN vs VPN) and any firewall between them.
$candidates = Get-LanCandidates
if ($candidates) {
    Write-Host "`nThis host's reachable addresses (give the client the one on ITS network):" -ForegroundColor Cyan
    foreach ($c in $candidates) {
        $url = if ($scheme -eq "https") { Format-BaseUrl $c.IPAddress $httpsPort } else { "http://$($c.IPAddress):$port" }
        Write-Host ("   {0,-15} {1,-28} [{2}]" -f $c.IPAddress, $url, $c.Kind) -ForegroundColor Gray
    }
    Write-Host "`n   FROM THE CLIENT MACHINE, confirm the network path BEFORE opening the browser:" -ForegroundColor Gray
    Write-Host "   Test-NetConnection <address> -Port $accessPort   # expect TcpTestSucceeded : True" -ForegroundColor Gray
    Write-Host "   If that is False, it is a network/firewall path issue (not this app) - see README." -ForegroundColor Gray
}

if ($Https) {
    Write-Host "`nThe first visit will show a certificate warning (self-signed internal CA) -" -ForegroundColor Gray
    Write-Host "see README.md 'HTTPS / internal CA' to install the trusted root certificate." -ForegroundColor Gray
}
Write-Host "`nStop with:   .\setup-and-start.ps1 -Stop" -ForegroundColor Gray
Write-Host "Update with: git pull; .\setup-and-start.ps1" -ForegroundColor Gray
