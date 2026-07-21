#!/usr/bin/env bash
# One-command setup and start for Project-Wrapped (Linux/macOS/WSL/Git Bash).
# Mirrors setup-and-start.ps1 - see that file's header comment for full docs.
#
# Default (recommended) mode builds and runs the database AND the app
# entirely through Docker Compose - only Docker is required on the host.
#
# Usage:
#   ./setup-and-start.sh                  Full Docker Compose deploy (db + app), plain HTTP
#   ./setup-and-start.sh --https          Same, plus Caddy HTTPS reverse proxy (internal CA)
#   ./setup-and-start.sh --ngrok          Same, plus a public outbound ngrok tunnel (prints URL)
#   ./setup-and-start.sh --dev            Local dev: DB in Docker, app via `npm run dev`
#   ./setup-and-start.sh --stop           Stop containers (data preserved)
#   ./setup-and-start.sh --reset-database Wipe the local database (asks to confirm)
#   ./setup-and-start.sh --reset-database --force   Same, without prompting
#   ./setup-and-start.sh --skip-install   (--dev only) skip npm install

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

DEV=false
STOP=false
RESET_DATABASE=false
FORCE=false
SKIP_INSTALL=false
HTTPS=false
NGROK=false

for arg in "$@"; do
  case "$arg" in
    --dev) DEV=true ;;
    --stop) STOP=true ;;
    --reset-database) RESET_DATABASE=true ;;
    --force) FORCE=true ;;
    --skip-install) SKIP_INSTALL=true ;;
    --https) HTTPS=true ;;
    --ngrok) NGROK=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

step() { printf "\n\033[36m==> %s\033[0m\n" "$1"; }
ok() { printf "\033[32mOK: %s\033[0m\n" "$1"; }
warn() { printf "\033[33mWARNING: %s\033[0m\n" "$1"; }
fail() { printf "\n\033[31mERROR: %s\033[0m\n" "$1" >&2; exit "${2:-1}"; }

echo -e "\033[36mProject-Wrapped Setup & Start\033[0m"
echo -e "\033[36m=============================\033[0m"

# ---------------------------------------------------------------------------
# Docker prerequisite checks
# ---------------------------------------------------------------------------
step "Checking Docker"

command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not in PATH. Install Docker from https://www.docker.com/products/docker-desktop/ and re-run this script."
ok "Docker CLI found: $(docker --version)"

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is not responding. Start Docker (Docker Desktop / dockerd) and re-run this script."
fi
ok "Docker daemon is running"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "Docker Compose is not available. Install/update Docker so the 'docker compose' plugin is available."
fi
ok "Docker Compose is available"

show_diagnostics() {
  echo -e "\n\033[33m--- docker compose ps ---\033[0m"
  "${COMPOSE[@]}" ps || true
  echo -e "\n\033[33m--- recent logs (last 50 lines per service) ---\033[0m"
  "${COMPOSE[@]}" logs --tail=50 || true
}

wait_healthy() {
  local service="$1" timeout="${2:-90}" waited=0
  echo "Waiting for '$service' to become healthy (timeout ${timeout}s)..."
  while [ "$waited" -lt "$timeout" ]; do
    local status
    status="$("${COMPOSE[@]}" ps --format json "$service" 2>/dev/null || true)"
    if echo "$status" | grep -qi '"health"[[:space:]]*:[[:space:]]*"healthy"'; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

get_ngrok_url() {
  # Reads the current public HTTPS URL from the local ngrok agent API.
  curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | grep -oE '"public_url":"https://[^"]+"' | head -n1 \
    | sed -E 's/.*"(https:[^"]+)".*/\1/'
}

stop_ngrok() {
  if pgrep -x ngrok >/dev/null 2>&1; then
    pkill -x ngrok >/dev/null 2>&1 || true
    ok "Stopped ngrok tunnel."
  fi
}

start_ngrok() {
  # Starts an OUTBOUND ngrok tunnel to http://localhost:$1 and sets
  # NGROK_PUBLIC_URL. Outbound only - no inbound firewall/IP/routing needed.
  local port="$1"
  NGROK_PUBLIC_URL=""
  if ! command -v ngrok >/dev/null 2>&1; then
    warn "ngrok is not installed or not in PATH - skipping the tunnel (the app is still running locally)."
    echo "   Install it (https://ngrok.com/download), run 'ngrok config add-authtoken <TOKEN>', then re-run with --ngrok."
    return 0
  fi
  if [ -n "${NGROK_AUTHTOKEN:-}" ]; then
    ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null 2>&1 && ok "ngrok auth token configured from NGROK_AUTHTOKEN."
  fi
  local existing; existing="$(get_ngrok_url)"
  if [ -n "$existing" ]; then
    ok "An ngrok tunnel is already running - reusing it."
    NGROK_PUBLIC_URL="$existing"; return 0
  fi
  local args=(http "$port" --log stdout)
  [ -n "${NGROK_DOMAIN:-}" ] && args+=(--domain "$NGROK_DOMAIN")
  [ -n "${NGROK_BASIC_AUTH:-}" ] && args+=(--basic-auth "$NGROK_BASIC_AUTH")
  step "Starting ngrok tunnel to http://localhost:$port"
  nohup ngrok "${args[@]}" >"$REPO_ROOT/ngrok.log" 2>&1 &
  local deadline=$(( $(date +%s) + 25 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 1
    local url; url="$(get_ngrok_url)"
    if [ -n "$url" ]; then NGROK_PUBLIC_URL="$url"; return 0; fi
  done
  warn "ngrok started but no public URL appeared within 25s."
  [ -f "$REPO_ROOT/ngrok.log" ] && tail -n 12 "$REPO_ROOT/ngrok.log" | sed 's/^/   /'
  echo "   Most common cause: no auth token. Run 'ngrok config add-authtoken <TOKEN>' or set NGROK_AUTHTOKEN in .env."
  return 0
}

# ---------------------------------------------------------------------------
# --stop: stop containers and exit (data preserved)
# ---------------------------------------------------------------------------
if [ "$STOP" = true ]; then
  step "Stopping Project-Wrapped containers"
  "${COMPOSE[@]}" stop
  stop_ngrok
  ok "Containers stopped. Data volume is preserved."
  echo "Run './setup-and-start.sh' again to restart, or 'docker compose down' to also remove the (stopped) containers."
  exit 0
fi

# ---------------------------------------------------------------------------
# .env file
# ---------------------------------------------------------------------------
step "Checking .env file"

if [ ! -f .env ]; then
  [ -f .env.example ] || fail ".env.example is missing from the repository. Cannot generate .env."
  cp .env.example .env
  # Generate secure local credentials instead of the committed placeholders.
  PG_PW="$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"
  SESSION_PW="$(head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)"
  sed -i.bak "s/POSTGRES_PASSWORD=password/POSTGRES_PASSWORD=${PG_PW}/" .env
  sed -i.bak "s/SESSION_SECRET=dev-secret-key/SESSION_SECRET=${SESSION_PW}/" .env
  rm -f .env.bak
  ok "Created .env from .env.example with freshly generated local database credentials."
  echo "   Edit .env later to add your Azure DevOps PAT or change other values."
else
  ok ".env already exists (leaving it untouched)"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DATABASE_URL:?Required environment variable DATABASE_URL is not set. Check your .env file against .env.example.}"
: "${PORT:?Required environment variable PORT is not set.}"
: "${POSTGRES_DB:?Required environment variable POSTGRES_DB is not set.}"
: "${POSTGRES_USER:?Required environment variable POSTGRES_USER is not set.}"
ok "Environment variables loaded"

PORT="${PORT:-5000}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

# ---------------------------------------------------------------------------
# --reset-database: destructive, requires confirmation
# ---------------------------------------------------------------------------
if [ "$RESET_DATABASE" = true ]; then
  warn "This will PERMANENTLY DELETE the local database volume (all saved wrapped projects)."
  if [ "$FORCE" = false ]; then
    read -r -p "Type 'yes' to continue, anything else to cancel: " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
      echo "Cancelled. No changes made."
      exit 0
    fi
  fi
  step "Resetting database"
  "${COMPOSE[@]}" down -v
  ok "Database volume removed. Continuing with a fresh setup..."
fi

# ---------------------------------------------------------------------------
# Port availability (best-effort)
# ---------------------------------------------------------------------------
step "Checking port availability"
for p in "$PORT" "$POSTGRES_PORT"; do
  if ! port_free "$p"; then
    warn "Port $p appears to be in use. If that's this project already running, this is fine. Otherwise, stop whatever else is using port $p, or change PORT/POSTGRES_PORT in .env."
  fi
done
ok "Port check complete"

# ---------------------------------------------------------------------------
# --dev: run the app on the host (hot reload) with only the DB in Docker
# ---------------------------------------------------------------------------
if [ "$DEV" = true ]; then
  command -v node >/dev/null 2>&1 || fail "Node.js is not installed or not in PATH. Install Node.js 18+ for --dev mode, or omit --dev to run everything in Docker instead."
  NODE_VERSION="$(node --version | sed 's/^v//')"
  if [ "${NODE_VERSION%%.*}" -lt 18 ]; then
    fail "Node.js 18+ is required for --dev mode (found v$NODE_VERSION)."
  fi
  ok "Node.js v$NODE_VERSION"

  if [ "$SKIP_INSTALL" = false ]; then
    step "Installing dependencies (npm ci)"
    if [ -f package-lock.json ]; then npm ci; else npm install; fi
    ok "Dependencies installed"
  fi

  step "Starting database (Docker Compose)"
  "${COMPOSE[@]}" up -d db
  if ! wait_healthy db 90; then
    show_diagnostics
    fail "Database did not become healthy in time."
  fi
  ok "Database is healthy"

  step "Applying database schema (drizzle-kit push)"
  npm run db:push || fail "Applying the database schema failed. Confirm DATABASE_URL in .env matches the database started above."
  ok "Schema is up to date"

  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"

  step "Starting application (development mode, hot reload)"
  echo -e "\033[36mLocal:   http://localhost:$PORT\033[0m"
  [ -n "$LAN_IP" ] && echo -e "\033[36mNetwork: http://$LAN_IP:$PORT\033[0m"
  echo "Press Ctrl+C to stop the server"
  echo
  npm run dev
  exit $?
fi

# ---------------------------------------------------------------------------
# Default: full Docker Compose deployment (database + containerised app) over
# plain HTTP. The app is published on PORT and binds 0.0.0.0, so other devices
# on the LAN can reach http://<lan-ip>:PORT. Pass --https to also start Caddy.
# ---------------------------------------------------------------------------
HTTPS_PORT="${APP_HTTPS_PORT:-443}"
if [ "$HTTPS" = true ]; then
  step "Building and starting containers with HTTPS (docker compose --profile https up -d --build)"
  "${COMPOSE[@]}" --profile https up -d --build
else
  step "Building and starting containers (docker compose up -d --build)"
  "${COMPOSE[@]}" up -d --build
fi

if ! wait_healthy db 90; then
  show_diagnostics
  fail "Database did not become healthy in time."
fi
ok "Database is healthy"

if ! wait_healthy app 120; then
  show_diagnostics
  fail "Application container did not become healthy in time. Run 'docker compose logs app' to investigate."
fi
ok "Application is healthy"

if [ "$HTTPS" = true ]; then
  if ! wait_healthy caddy 60; then
    show_diagnostics
    fail "Reverse proxy (Caddy) did not become healthy in time. Run 'docker compose logs caddy' to investigate."
  fi
  ok "Reverse proxy is healthy"
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"

echo -e "\n\033[32mProject-Wrapped is running.\033[0m"
if [ "$HTTPS" = true ]; then
  echo -e "\033[36mLocal:   https://localhost:${HTTPS_PORT}\033[0m"
  [ -n "$LAN_IP" ] && echo -e "\033[36mNetwork: https://$LAN_IP:${HTTPS_PORT}  <-- open this from the other PC\033[0m"
  echo "The first visit shows a certificate warning (self-signed internal CA) - see README.md 'HTTPS / internal CA'."
else
  echo -e "\033[36mLocal:   http://localhost:$PORT\033[0m"
  [ -n "$LAN_IP" ] && echo -e "\033[36mNetwork: http://$LAN_IP:$PORT  <-- open this from the other PC\033[0m"
  echo "Your OS firewall may need to allow inbound connections on port $PORT for other devices to reach it."
fi

if [ "$NGROK" = true ]; then
  start_ngrok "$PORT"
  if [ -n "${NGROK_PUBLIC_URL:-}" ]; then
    echo -e "\n\033[32m==================================================================\033[0m"
    echo -e "\033[32m PUBLIC URL (open from ANY other PC - no VPN/firewall/IP needed):\033[0m"
    echo -e "\033[36m   $NGROK_PUBLIC_URL\033[0m"
    echo -e "\033[32m==================================================================\033[0m"
    [ -z "${NGROK_BASIC_AUTH:-}" ] && warn "This app has NO login and the tunnel is PUBLIC. Set NGROK_BASIC_AUTH=user:pass in .env to protect it."
    echo "   Local ngrok inspector: http://127.0.0.1:4040   |   Stop: ./setup-and-start.sh --stop"
  fi
fi
echo -e "\nStop with:   ./setup-and-start.sh --stop"
echo "Update with: git pull && ./setup-and-start.sh"
