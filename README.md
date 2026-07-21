# Project-Wrapped

A **Spotify Wrapped-style** web application that visualizes your Azure DevOps project statistics in an engaging, interactive presentation.

## What is this?

Project-Wrapped takes your Azure DevOps data and transforms it into a beautiful "year in review" experience, similar to Spotify Wrapped. It shows your team's achievements, top contributors, busiest days, and key milestones in an animated slideshow format.

## Features

- 📊 **Global Stats** - Total commits, PRs, code reviews, comments, bugs fixed, story points
- 🏆 **Champions** - Top 10 contributors ranked by activity
- 📁 **Modules** - Breakdown by project areas/teams
- 🥇 **Top 5 Rankings** - Most commits, most PRs, most reviews, busiest days
- ⭐ **Highlights** - Auto-generated achievements (e.g., "3,341 commits pushed")
- 📅 **Timeline** - Key milestones throughout the period
- 🎨 **Interactive UI** - Animated slides with smooth transitions

## Data Sources

Connects to Azure DevOps (cloud or on-premises) and fetches:
- Git commits from all repositories
- Pull requests with reviewer (vote) data
- Work items (Bugs, Features, Test Cases, Requirements, etc.)

> **Not collected (by design):** PR discussion comments and lines-added/deleted / files
> changed are intentionally omitted — scanning every PR thread and diff at project scale
> is too slow, so those metrics are left out rather than shown partially. Each generated
> recap includes a **"How these numbers were calculated"** panel with the exact filters,
> counts and KPI definitions used. See [ROADMAP.md](ROADMAP.md) for planned work and the
> full list of metric definitions and assumptions.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Radix UI
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **API**: Azure DevOps REST API

## ⚠️ Security note: no authentication

Project-Wrapped currently has **no login / authentication** on any route.
Anyone who can reach the app's URL can view, create and upload wrapped
projects. This is fine for local use or a trusted LAN, but:

> **Do not expose this app directly to the internet without adding your own
> access control** (e.g. a reverse proxy with HTTP basic auth / OAuth, or a
> private tunnel/VPN restricted to people you trust). See
> [Internet / production deployment](#internet--production-deployment) below.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose plugin) — required for the recommended setup
- [Node.js](https://nodejs.org/) 18+ (20+ recommended) — **only** needed for local development (`-Dev` / `--dev` mode)
- Azure DevOps Personal Access Token (PAT), only needed when connecting to Azure DevOps:
  - Code (Read)
  - Work Items (Read)

## Quick start (fresh clone, Windows)

```powershell
git clone <repository-url>
cd Project-Wrapped
.\setup-and-start.ps1
```

That single command validates Docker, creates `.env` (with freshly generated
local database credentials), builds and starts the database and the app in
Docker over plain HTTP, waits for both to become healthy, applies the
database schema, opens the Windows Firewall port (when run as Administrator),
and prints the URLs below. No manual `npm install`, migration, or extra
Docker commands are needed.

- **Open locally:** `http://localhost:5000`
- **From another device on the same network (LAN):** `http://<this-computer's-LAN-IP>:5000` (printed by the script)
- **Optional HTTPS:** add `-Https` to serve TLS on port 443 via Caddy (self-signed internal CA - see [HTTPS / internal CA](#https--internal-ca))
- **Stop it:** `.\setup-and-start.ps1 -Stop` (data is preserved)
- **Update after `git pull`:** just re-run `.\setup-and-start.ps1` (it rebuilds the image and reapplies the schema)
- **Persistent data:** stored in the Docker named volume `project_wrapped_pgdata` — it survives `docker compose down` and computer restarts, and is only deleted by `-ResetDatabase`
- **Back up the database:** see [Backing up and restoring the database](#backing-up-and-restoring-the-database)
- **LAN access ≠ internet access:** the LAN URL above only works for devices on your local network. Making the app reachable from the internet is a separate, additional step — see [Internet / production deployment](#internet--production-deployment)

macOS/Linux/WSL equivalent: `./setup-and-start.sh` (see [setup-and-start.sh](setup-and-start.sh)).

## Deployment modes

There are three distinct ways to run this app - pick the one that matches what you're doing:

| Mode | Command | Requires Node.js on host? | Use case |
|---|---|---|---|
| **Docker Compose (recommended)** | `.\setup-and-start.ps1` or `docker compose up -d --build` | No | Fresh installs, daily use, LAN sharing, the base for internet deployment |
| **Local development** | `.\setup-and-start.ps1 -Dev` | Yes | Editing code with hot reload (Vite HMR) |
| **Internet / production** | Docker Compose **+** a reverse proxy (Nginx/Caddy) with HTTPS | No | Making the app reachable outside your LAN |

### Docker Compose (recommended default)

```powershell
.\setup-and-start.ps1
```

Internally this runs `docker compose up -d --build`, which starts two
containers: `db` (PostgreSQL) and `app` (the built, production-mode server,
published directly on `PORT`/`5000` and bound to `0.0.0.0` so other devices
on the LAN can reach it over plain HTTP). The script just adds prerequisite
checks, `.env` bootstrapping, health-check waiting, a Windows Firewall rule,
and friendly status output — you can also run the plain Compose commands
yourself once `.env` exists:

```bash
git pull
docker compose up -d --build
```

To additionally terminate TLS with the optional Caddy reverse proxy, use
`.\setup-and-start.ps1 -Https` (or `docker compose --profile https up -d --build`).

### Local development

For active development with hot reload:

```powershell
.\setup-and-start.ps1 -Dev
```

This starts **only** the database in Docker and runs the app on the host
with `npm run dev` (Vite HMR), matching the previous `start-dev.ps1` /
`start-dev.bat` behavior (still available as a compatibility wrapper). Requires
Node.js 18+.

### Internet / production deployment

See [Internet / production deployment](#internet--production-deployment) below for the full checklist — running `docker compose up -d --build` makes the app *reachable*, but is not by itself internet/production-safe (see the security note above).

### Script options

| PowerShell | Bash | Description |
|---|---|---|
| *(none)* | *(none)* | **Recommended.** Build/start database + app in Docker over plain HTTP (reachable at `http://<lan-ip>:5000`) |
| `-Https` | `--https` | Also start the Caddy reverse proxy for HTTPS on port 443 (self-signed internal CA) |
| `-Ngrok` | `--ngrok` | Also open a public **outbound** ngrok tunnel and print an `https://…ngrok…` URL that works through corporate firewalls/VPNs/VLANs (no inbound access needed) |
| `-Dev` | `--dev` | Local development: DB in Docker, app on the host with hot reload (requires Node.js) |
| `-Stop` | `--stop` | Stop the running containers (data preserved) |
| `-ResetDatabase` | `--reset-database` | **Destructive.** Deletes the local database volume. Asks for confirmation unless `-Force` / `--force` is also given |
| `-Force` | `--force` | Skips the confirmation prompt for `-ResetDatabase` |
| `-SkipInstall` | `--skip-install` | `-Dev` only: skip `npm install` |
| `-AdvertisedHost <ip>` | `--advertised-host <ip>` | Override the address shown in the printed "Network:" URL (e.g. when auto-detection picks a VPN/virtual adapter) |
| `-HttpsPort <port>` | `--https-port <port>` | With `-Https`: host port Caddy publishes for HTTPS (default `443`). Use if `443` is already occupied - the script reports the owning process instead of silently picking another port |

The scripts are idempotent: re-running them will not overwrite `.env`, reuse
existing containers/volumes, and never delete data unless `-ResetDatabase`
(with confirmation) is used.

### Manual / alternative setup

If you prefer not to use the script:

```bash
cp .env.example .env          # Windows: Copy-Item .env.example .env
docker compose up -d --build  # starts PostgreSQL + the app, applies the schema automatically
```

Or for local development without Docker for the app:

```bash
npm install
docker compose up -d db       # starts PostgreSQL only
npm run db:push               # applies the schema
npm run dev                   # starts the app (http://localhost:5000)
```

## Environment variables

All variables are documented with safe example values in
[.env.example](.env.example), grouped into **required**, **optional**,
**development-only** and **production** sections. Copy it to `.env`
(git-ignored, never commit it) and adjust as needed - or let the setup
scripts create it for you with secure generated credentials.

| Variable | Group | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Required | — | PostgreSQL connection string used by the app and `drizzle-kit` |
| `PORT` | Required | `5000` | Port the server listens on and the host/LAN port published by Docker Compose (plain HTTP) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Required | see `.env.example` | Configure the Docker Compose database container; keep in sync with `DATABASE_URL` |
| `POSTGRES_PORT` | Optional | `5432` | Host port mapped to the database container (bound to `127.0.0.1` only) |
| `HOST` | Optional | `0.0.0.0` | Interface the server binds to. `0.0.0.0` allows LAN/container access; `127.0.0.1` restricts to this machine only |
| `APP_HTTPS_PORT` | Optional | `443` | With `-Https` only: host port the Caddy reverse proxy publishes for HTTPS. Change if `443` is already used by another service |
| `ADVERTISED_HOST` | Optional | auto-detected | IP/hostname other devices use to reach this deployment - only affects printed URLs/logging, never how anything binds |
| `AZURE_DEVOPS_BASE_URL` / `AZURE_DEVOPS_ORGANIZATION` / `AZURE_DEVOPS_PROJECT` | Optional | — | Non-secret defaults prefilled into the "Connect to Azure DevOps" dialog. Users can still edit/override every field |
| `AZURE_DEVOPS_PAT` | Optional | — | Server-side only; never sent to the browser (only a `hasConfiguredPat` boolean is). Used when a user leaves the PAT field blank. **Shared by everyone using this deployment** - see [Azure DevOps connection defaults](#azure-devops-connection-defaults) |
| `NODE_ENV` | Development-only | `development` | Set automatically by the setup scripts / Docker image; you shouldn't need to set it yourself |
| `SESSION_SECRET` | Development-only | auto-generated | Reserved for future session/auth support (not currently read by the app) |
| *(none currently)* | Production | — | No further app-specific production variables beyond the above; a public-domain/public-CA reverse proxy config lives in `deploy/`, not in `.env` |

### Azure DevOps connection defaults

If `AZURE_DEVOPS_BASE_URL` / `AZURE_DEVOPS_ORGANIZATION` / `AZURE_DEVOPS_PROJECT`
are set, the "Connect to Azure DevOps" dialog prefills those fields from
`GET /api/config/azure-devops` - a non-secret endpoint that never returns the
PAT itself. Users can still edit or replace every field for their own
connection attempt; nothing they type is written back to `.env`.

If `AZURE_DEVOPS_PAT` is also set, the dialog shows a note that a PAT is
configured for this deployment. Leaving the PAT field blank uses that
environment PAT server-side for the request; typing a PAT always overrides it
for that connection only. **Anyone with network access to this deployment's
HTTPS endpoint can use the configured PAT** (there is no authentication - see
the security note above) - only set `AZURE_DEVOPS_PAT` if you're comfortable
sharing that token with everyone who can reach this instance.

## Database schema updates

This project uses `drizzle-kit push` (schema sync) rather than committed SQL
migration files - `docker-entrypoint.sh` runs it automatically every time the
`app` container starts, and `npm run db:push` does the same for local
development. This keeps setup to a single command, but it's worth
understanding what it does:

- **On a fresh/empty database** (first install), this is always safe - it's a
  plain, non-interactive schema creation.
- **On an existing database**, `drizzle-kit push` compares the live schema to
  [shared/schema.ts](shared/schema.ts) and applies the difference. Additive
  changes (new tables/columns) are safe. Changes that could lose data (e.g.
  dropping/renaming a column) are **not applied silently** - the container
  does not pass `--force`, so an ambiguous change will make `drizzle-kit`
  ask for confirmation rather than auto-approving data loss. In a
  non-interactive container that means the entrypoint will not proceed
  automatically; check `docker compose logs app` and apply the change with an
  interactive `docker compose exec app npx drizzle-kit push` if that happens.
- **The setup scripts never reset the database during a normal start** -
  only `-ResetDatabase` / `--reset-database` (with confirmation) does that.
- **Always back up before pulling an update that changes the schema** - see
  the backup command below. If you're not sure whether an update changes the
  schema, check the diff of [shared/schema.ts](shared/schema.ts) or just back
  up anyway; it takes a few seconds.

If this project starts holding data you can't afford to lose in production,
consider moving to committed migration files (`drizzle-kit generate` +
`drizzle-kit migrate`) instead of `push` - that's a deliberate architecture
change outside the scope of this setup pass.

## Accessing the app from another computer (LAN)

The `app` container is published directly on `PORT` (default `5000`) and binds
all interfaces (`0.0.0.0`), so once running you can open it from any other
device on the same network at:

```
http://<host-machine-LAN-IP>:5000
```

(replace `5000` with `PORT` if you changed it). Find your machine's LAN IP with
`ipconfig` (Windows) or `ip addr` / `ifconfig` (macOS/Linux). The setup scripts
print this URL automatically and list every reachable address of the host so
you can hand the client the one on its network. **This is LAN-only** - it does
not make the app reachable from the internet.

If the other PC cannot connect, check, in order:

1. **Firewall** - the inbound rule must exist for the port (see [Firewall](#firewall) below). This is the most common cause of "works locally, not remotely".
2. **Same network** - both machines must be on the same LAN/subnet with no client isolation (guest Wi-Fi / different VLAN blocks peer traffic).
3. **Correct IP** - use the host's address on the *client's* network. Verify from the client with `Test-NetConnection <ip> -Port 5000` (expect `TcpTestSucceeded : True`); if that is `False` it is a network/firewall path issue, not the app.

Prefer HTTPS? Start with `-Https` and read [HTTPS / internal CA](#https--internal-ca)
for the extra certificate step each client needs.

### Remote access via ngrok (through a corporate firewall / VPN / VLAN)

If the server PC is reachable to you only over RDP/AnyDesk and corporate
firewall, VPN or VLAN rules block opening port `5000`/`443` directly from your
own machine, stop fighting inbound access and use an **outbound** ngrok tunnel
instead. ngrok connects *out* from the server and hands you a public HTTPS URL
that works from anywhere - no inbound firewall rule, correct server IP, or LAN
routing required.

**One-time setup on the server PC:**

1. Install ngrok: `winget install ngrok.ngrok` (or `choco install ngrok`, or download from <https://ngrok.com/download>).
2. Create a free account and copy your auth token from <https://dashboard.ngrok.com/get-started/your-authtoken>.
3. Either run `ngrok config add-authtoken <TOKEN>` once, or put `NGROK_AUTHTOKEN=<TOKEN>` in [.env](.env) (git-ignored).

**Every time you want remote access:**

```powershell
.\setup-and-start.ps1 -Ngrok
```

The script starts the database + app, confirms the app is healthy locally,
starts the tunnel, and prints:

```
 PUBLIC URL (open this from ANY other PC - no VPN/firewall/IP needed):
   https://<random>.ngrok-free.app
```

Open that URL in the browser on your own PC. The tunnel runs in the background
until you run `.\setup-and-start.ps1 -Stop` (which also stops the tunnel).
Inspect live requests at <http://127.0.0.1:4040> on the server.

> **Security:** the app has **no login**, so a public ngrok URL is reachable by
> anyone who has it (and can use any configured `AZURE_DEVOPS_PAT`). Protect it
> with HTTP Basic Auth by setting `NGROK_BASIC_AUTH=user:password` in `.env` -
> ngrok then prompts every visitor for those credentials before allowing
> access. For a stable URL that doesn't change each restart (paid ngrok
> feature), set `NGROK_DOMAIN=<your-reserved-domain>`. On the free plan the
> first visit shows an ngrok interstitial page - click through once to continue.

macOS/Linux/WSL: `./setup-and-start.sh --ngrok` (same behaviour).

### HTTPS / internal CA

HTTPS is **optional** and only runs when you start with `-Https`
(`--https`). This deployment is reached by IP address, not a public domain
name, so Caddy issues certificates from its own internal CA (`tls internal` in
[Caddyfile](Caddyfile)) instead of a publicly-trusted one like Let's
Encrypt. That's why browsers show a certificate warning until that CA is
trusted. To remove the warning on a client Windows computer:

1. Export the generated root certificate from the running `caddy` container:
   ```powershell
   docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt .\project-wrapped-ca.crt
   ```
2. Install it into the Trusted Root Certification Authorities store (requires
   Administrator):
   ```powershell
   Import-Certificate -FilePath .\project-wrapped-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
   ```
   Or double-click the `.crt` file → **Install Certificate** → **Local
   Machine** → **Place all certificates in the following store** → **Trusted
   Root Certification Authorities**.
3. Restart the browser and reopen the HTTPS URL - the warning should be gone.

Only the certificate (`root.crt`) is exported - never the private key
(`root.key`), which stays inside the `caddy` container/volume. Do not commit
the exported `.crt` file to the repository; it's specific to this
deployment's Caddy instance and is regenerated if the `project_wrapped_caddy_data`
volume is ever removed.

For diagnostics only, you can skip certificate verification with
`curl.exe -k` - never disable TLS verification in the application itself.

### Firewall

The setup script creates an inbound Windows Firewall rule for the app port
(`5000` by default, or `443` when started with `-Https`) automatically **when
run as Administrator**. If it isn't run elevated, it prints the exact command
to run yourself:

```powershell
New-NetFirewallRule -DisplayName "Project-Wrapped HTTP 5000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -Profile Domain,Private
```

(use `"Project-Wrapped HTTPS 443"` / `-LocalPort 443` when running with `-Https`).
The rule is idempotent (re-running the script never creates a duplicate) and
scoped to the Domain/Private firewall profiles rather than every network.
Only the app port needs to be reachable from other devices; the database port
(`5432` by default) is bound to `127.0.0.1` only and is never exposed to the
LAN or internet.

> **This firewall step is the usual root cause of "the app runs on the server
> but I can't open it from another PC".** If auto-creation was skipped because
> the script wasn't elevated, run the printed `New-NetFirewallRule` command in
> an Administrator PowerShell once - it persists across restarts.

## Internet / production deployment

> **This app is not "production-ready" just because it listens on `0.0.0.0`
> or runs in Docker.** Beyond the app itself, exposing anything to the public
> internet requires you to separately handle:
>
> - **Authentication / access control** - this app has none (see the security
>   note above). Put it behind a reverse proxy with HTTP basic auth, OAuth,
>   or a private tunnel/VPN limited to people you trust.
> - **A server or computer that stays online** (a VPS, home server, NAS, etc.).
> - **Public DNS pointing at it, or a secure tunnel** - forwarding a port
>   directly on a home/office router exposes that router to the internet.
>   A tunnel such as [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
>   or [Tailscale](https://tailscale.com/) avoids opening inbound firewall
>   ports at all and is generally safer for home/office setups - these are
>   optional, separate tools and are **not** part of the default local setup.
> - **Router/firewall configuration**, if you do forward a port.
> - **TLS/HTTPS** via a reverse proxy (see below) - never send the PAT/API
>   traffic over plain HTTP on the internet.
> - **Secure secret management** - rotate `POSTGRES_PASSWORD`/`SESSION_SECRET`
>   for anything internet-facing rather than reusing local dev values.
> - **Backups** (see below) and a plan for **applying updates**
>   (`git pull && docker compose up -d --build`).

The recommended path is Docker Compose (as above) plus a **separate**
public-facing reverse proxy in front of it that terminates TLS with a
publicly-trusted certificate for your real domain (the built-in `caddy`
service already terminates TLS for LAN/IP access with an internal CA - see
[HTTPS / internal CA](#https--internal-ca) - but that certificate is not
trusted by browsers over the public internet, so a domain deployment needs
its own public-CA proxy in front rather than reusing it).

Example configs are provided for both:
- [deploy/nginx.conf.example](deploy/nginx.conf.example) — needs `certbot` (or similar) for certificates
- [deploy/Caddyfile.example](deploy/Caddyfile.example) — automatically provisions and renews Let's Encrypt certificates

Copy one, replace the domain, and point it at the app's HTTPS port
(`127.0.0.1:${APP_HTTPS_PORT}`, i.e. the built-in `caddy` service - not the
app container directly, which is never published to the host).

## Stopping the app

```powershell
.\setup-and-start.ps1 -Stop
```

or directly:

```bash
docker compose stop     # stop containers, keep them (and all data) for next time
docker compose down     # also remove the (stopped) containers - data volume is preserved
```

If you're running `-Dev` mode, press `Ctrl+C` in the terminal running
`npm run dev`, then optionally `docker compose stop db`.

## Updating after `git pull`

```bash
git pull
.\setup-and-start.ps1
```

Re-running the script (or `docker compose up -d --build`) rebuilds the image
with your latest code and reapplies the database schema - safe to run anytime.
**Back up the database first if the update changes `shared/schema.ts`** (see
[Database schema updates](#database-schema-updates)).

## Backing up and restoring the database

**Backup:**

```bash
docker compose exec db pg_dump -U postgres project_wrapped > backup.sql
```

**Restore** (into a running, empty database):

```bash
docker compose exec -T db psql -U postgres project_wrapped < backup.sql
```

Adjust `postgres` / `project_wrapped` if you changed `POSTGRES_USER` / `POSTGRES_DB`.
Do this before any update that changes the database schema.

## Resetting your local deployment

To wipe the local database and start clean:

```powershell
.\setup-and-start.ps1 -ResetDatabase
```

```bash
./setup-and-start.sh --reset-database
```

Both ask you to type `yes` to confirm (or pass `-Force` / `--force` to skip
the prompt). This stops the database container and **deletes its data
volume** — any saved wrapped projects will be lost. The schema is re-applied
automatically on the next start.

## Usage



### Creating a Wrapped Project

1. Open the app in your browser
2. Enter your Azure DevOps details:
   - **Organization/Collection**: Your Azure DevOps organization name (e.g., "MyOrg")
   - **Project**: Project name (e.g., "MyProject")
   - **Personal Access Token**: Your PAT with Code and Work Items read permissions
   - **Base URL** (optional): For on-premises servers (e.g., `https://tfs.mycompany.com/`)
   - **Date Range** (optional): Filter to specific time period
3. Click "Create Wrapped"
4. Watch your project's story unfold!

### API Endpoints

```bash
# Create a wrapped project
POST /api/connect/azure-devops
{
  "organization": "MyOrg",
  "project": "MyProject",
  "personalAccessToken": "your-pat-token",
  "baseUrl": "https://dev.azure.com/",  # optional
  "dateFrom": "2024-01-01",              # optional
  "dateTo": "2024-12-31"                 # optional
}

# Get wrapped project data
GET /api/wrapped/{project-id}
```

## Project Structure

```
Project-Wrapped/
├── client/                 # React frontend
│   └── src/
│       ├── components/     # UI components
│       │   └── slides/     # Wrapped presentation slides
│       ├── pages/          # Page components
│       └── hooks/          # Custom React hooks
├── server/                 # Express backend
│   ├── services/
│   │   └── azure-devops.ts # Azure DevOps API integration
│   └── routes.ts           # API routes
├── shared/                 # Shared types/schemas
│   └── schema.ts           # Database schema & types
├── deploy/                 # Example reverse proxy configs (Nginx, Caddy)
├── docker-compose.yml      # Postgres database + containerised app (recommended deployment)
├── Dockerfile              # Production image for the app service
├── docker-entrypoint.sh    # Applies the DB schema, then starts the app container
├── setup-and-start.ps1     # Windows setup/start script (default: full Docker Compose; -Dev: local dev)
├── setup-and-start.sh      # macOS/Linux/WSL equivalent
└── start-dev.bat           # Legacy Windows entry point (delegates to setup-and-start.ps1 -Dev)
```

## Scripts

| Command | Description |
|---------|-------------|
| `.\setup-and-start.ps1` / `./setup-and-start.sh` | **Recommended.** Build + start database and app in Docker |
| `.\setup-and-start.ps1 -Dev` / `./setup-and-start.sh --dev` | Local development with hot reload (DB in Docker, app on host) |
| `.\setup-and-start.ps1 -Stop` / `./setup-and-start.sh --stop` | Stop containers (data preserved) |
| `docker compose up -d --build` | Same as the default script mode, without the extra checks/output |
| `docker compose down` | Stop and remove containers (data volume preserved) |
| `npm run dev` | Start the dev server directly (expects `DATABASE_URL` etc. to already be set) |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm test` | Run the test suite |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push database schema changes |

## Azure DevOps API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/git/repositories` | List all repositories |
| `/git/repositories/{id}/commits` | Get commits |
| `/git/repositories/{id}/pullrequests` | Get pull requests |
| `/git/repositories/{id}/pullrequests/{id}/threads` | Get PR comments |
| `/wit/wiql` | Query work items |
| `/wit/workitems` | Get work item details |

## Troubleshooting

### Docker is not installed / not running
- Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and make sure it's running before using the setup scripts (`docker ps` should succeed).

### `docker compose` command not found
- Update Docker Desktop, or install the Compose plugin — it ships with Docker Desktop by default. Older standalone `docker-compose` also works.

### Database Connection Error
- Verify the database container is up and healthy: `docker compose ps`
- Check `DATABASE_URL` in `.env` matches the `POSTGRES_*` values
- Check logs: `docker compose logs db` / `docker compose logs app`
- Run `npm run db:push` to (re)initialize the schema (only needed in `-Dev` mode - the `app` container does this automatically on start)
- If a port conflict prevents the DB from starting (`5432` already in use), change `POSTGRES_PORT` in `.env` and update `DATABASE_URL` to match

### Port already in use
- Change `PORT` (and/or `POSTGRES_PORT`) in `.env` to a free port and restart

### `app` container is unhealthy / keeps restarting
- `docker compose logs app` almost always shows the reason (commonly: `DATABASE_URL` mismatch, or the database not yet healthy - Compose's `depends_on: condition: service_healthy` should prevent this, but check `docker compose ps` to confirm `db` is healthy first)

### Docker Desktop / WSL2 networking gets stuck
- If `docker network create`, `docker run` with new port bindings, or `docker compose up` hang indefinitely (while `docker ps` still works), Docker Desktop's network backend has likely gotten stuck. Fully quit Docker Desktop, run `wsl --shutdown`, then relaunch Docker Desktop and give it a few minutes to fully restart. If it persists, reboot Windows.

### Azure DevOps Authentication Error
- Verify PAT has correct permissions (Code: Read, Work Items: Read)
- Check organization and project names are correct
- For on-premises, ensure `baseUrl` is set correctly

### SSL Certificate Error (On-Premises)
- The app automatically disables SSL verification for on-premises servers with self-signed certificates

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run check` to verify TypeScript
5. Submit a pull request

## Author

Created by [@zemacedo99](https://github.com/zemacedo99)
