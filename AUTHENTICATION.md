# Authentication — Cloudflare Access (email one-time PIN)

Project-Wrapped supports authentication via **Cloudflare Zero Trust /
Cloudflare Access** with the **One-Time PIN** login method: users enter their
email address, Cloudflare emails them a one-time code, and only after entering
it do they reach the app.

The app itself never sees passwords or OTP codes and never sends email —
Cloudflare handles the entire login flow at the edge. The app's only job is to
**verify** that each request really went through Cloudflare Access, by
validating the signed JWT Cloudflare attaches to every authenticated request.

```
Browser ──▶ Cloudflare edge (email + one-time PIN login)
                 │  adds Cf-Access-Jwt-Assertion header (signed JWT)
                 ▼
        Cloudflare Tunnel (cloudflared, outbound-only)
                 │
                 ▼
        Project-Wrapped server ── verifies the JWT signature (JWKS),
                                  issuer, audience and expiry before
                                  trusting the email inside it
```

## Why this design

- **No custom OTP system**: no codes generated, stored, or emailed by the app;
  no passwords anywhere. (Security rule: don't build what Cloudflare already
  provides.)
- **Headers are only trusted after verification**: a client talking to the
  server directly (e.g. on the LAN, or if the origin leaks) can set
  `Cf-Access-Jwt-Assertion` to anything — so the server verifies the JWT's
  RS256 signature against your team's public keys
  (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), plus the
  issuer, the application audience (AUD) tag and expiry, before trusting the
  email claim. Forged or missing tokens get `401 Unauthorized`.
- **Defense in depth**: Cloudflare already blocks unauthenticated users at the
  edge; the app-level check additionally protects against anyone who can reach
  the origin without going through Cloudflare.

## Part 1 — Configure Cloudflare (one-time, manual)

You need a free Cloudflare account with **Zero Trust** enabled (the free plan
covers up to 50 users) and a domain managed by Cloudflare (or use Cloudflare's
`*.cfargotunnel.com`/quick-tunnel options for testing).

### 1. Expose the app through a Cloudflare Tunnel (recommended)

This deployment typically runs behind a corporate firewall, so an
**outbound-only** tunnel (like the existing ngrok option) is the natural fit —
no inbound firewall rules needed:

1. In [Zero Trust dashboard](https://one.dash.cloudflare.com/) go to
   **Networks → Tunnels → Create a tunnel** (Cloudflared connector).
2. Install and run `cloudflared` on the server machine with the token the
   dashboard gives you, e.g. on Windows:
   ```powershell
   winget install Cloudflare.cloudflared
   cloudflared service install <TUNNEL_TOKEN>
   ```
3. Add a **Published application route / public hostname** for the tunnel,
   e.g. `wrapped.example.com` → service `http://localhost:5000` (the app's
   plain-HTTP port; the tunnel itself is encrypted, so the internal Caddy
   HTTPS profile is not needed here).

Alternative: if the server is directly reachable from the internet, you can
skip the tunnel and just point a Cloudflare-proxied (orange-cloud) DNS record
at it — but then you **must** firewall the origin so only
[Cloudflare IP ranges](https://www.cloudflare.com/ips/) can reach port 5000,
otherwise Access can be bypassed at the network level (the app's JWT check
will still return 401, but don't rely on a single layer).

### 2. Enable the One-Time PIN login method

1. Zero Trust dashboard → **Settings → Authentication → Login methods**.
2. **Add new** → **One-time PIN**. (No IdP setup needed — Cloudflare emails
   the codes.)

### 3. Create the Access application

1. Zero Trust dashboard → **Access → Applications → Add an application** →
   **Self-hosted**.
2. **Application name**: e.g. `Project-Wrapped`.
3. **Public hostname**: the hostname from step 1 (e.g. `wrapped.example.com`),
   path left empty so the **entire app** (UI and API) is protected.
4. **Session duration**: e.g. `24h` (users re-enter a PIN when it expires).
5. **Login methods**: select **One-time PIN** (disable others if you want
   email-code only, and turn off "Accept all available identity providers").
6. Add an **Allow policy** defining who may log in:
   - *Include → Emails ending in* `@yourcompany.com` (allowed domain), and/or
   - *Include → Emails* with an explicit list of addresses.
   Anyone not matched can request a PIN but will be denied.
7. Save. On the application's **Overview** tab, copy:
   - the **Application Audience (AUD) tag** (64-char hex) → `CF_ACCESS_AUD`
   - your **team domain** (Settings → Custom Pages, e.g.
     `myteam.cloudflareaccess.com`) → `CF_ACCESS_TEAM_DOMAIN`

No callback URL needs to be configured for self-hosted applications —
Cloudflare handles the login redirect on `<team>.cloudflareaccess.com`
automatically.

### 4. (Optional) Harden Access

- **Access → Applications → (app) → Settings**: enable **Binding cookie** and
  **HTTP-only cookie** (defaults are fine).
- Add a **WAF / rate limiting** rule if the hostname is high-profile.

## Part 2 — Configure the app

Set these in `.env` (see [.env.example](.env.example)) and restart
(`docker compose up -d --build` or `.\setup-and-start.ps1`):

| Variable | Example | Purpose |
|---|---|---|
| `AUTH_MODE` | `cloudflare-access` | Turns JWT enforcement on. Default is `disabled` (pre-existing no-auth LAN behavior) |
| `CF_ACCESS_TEAM_DOMAIN` | `myteam.cloudflareaccess.com` | Your Zero Trust team domain; determines the JWT issuer and the JWKS URL. Not a secret |
| `CF_ACCESS_AUD` | `f8a2b6…` (64 hex chars) | The Access application's Audience tag; the JWT must be issued for this application. Not a secret |
| `DEV_AUTH_EMAIL` | `dev@example.com` | **`AUTH_MODE=dev-bypass` only** — fake identity for local development. Refused when `NODE_ENV=production` |

None of these are secrets, but `.env` stays git-ignored regardless. With
`AUTH_MODE=cloudflare-access` the app **fails at startup** if the team domain
or AUD is missing — it never silently runs unprotected in that mode.

## Route protection map

| Route | Protection | Why |
|---|---|---|
| `GET /api/health` | Public | Docker/Compose healthchecks call it from inside the network where no Cloudflare JWT exists. Returns a static `{"status":"ok"}` only |
| `GET /api/auth/me` | Public | Lets the frontend render the signed-in state. Returns only `{authenticated, email, mode}` — never tokens, PATs or config |
| `GET /api/config/azure-devops` | **401 without auth** | Reveals org/project defaults and whether a PAT is configured |
| `GET /api/wrapped`, `GET /api/wrapped/:id` | **401 without auth** | Saved report data |
| `POST /api/upload-json` | **401 without auth** | Imports data |
| `POST /api/connect/azure-devops`, `POST /api/test/azure-devops` | **401 without auth** | Connects to Azure DevOps and can use the server-side `AZURE_DEVOPS_PAT` |
| `POST /api/connect/github` | **401 without auth** | Connects to GitHub |
| Static frontend (`/`, JS/CSS) | Cloudflare edge only | The SPA shell contains no data; every API call it makes is protected server-side. Cloudflare Access blocks it at the edge anyway |

## Local development

Normal local dev needs no Cloudflare at all — two options:

- **No auth (default)**: leave `AUTH_MODE=disabled` (or unset). Exactly the
  pre-existing behavior; the auth badge in the UI stays hidden.
- **Simulate a signed-in user**: set in `.env`
  ```
  AUTH_MODE=dev-bypass
  DEV_AUTH_EMAIL=you@example.com
  ```
  then `.\setup-and-start.ps1 -Dev`. Every request is treated as that user and
  the badge shows the email. This mode is refused when `NODE_ENV=production`
  and is not passed into the Docker image by docker-compose.yml, so it cannot
  leak into a deployment by accident.

## Verifying it works

With `AUTH_MODE=cloudflare-access` configured:

```bash
# Direct to the origin, no token -> 401
curl -i http://localhost:5000/api/wrapped
# -> HTTP/1.1 401 ... {"error":"Authentication required"}

# Health stays public (for container healthchecks)
curl -i http://localhost:5000/api/health
# -> 200 {"status":"ok"}

# Auth status endpoint is public but reports unauthenticated
curl -s http://localhost:5000/api/auth/me
# -> {"authenticated":false,"email":null,"mode":"cloudflare-access"}

# A forged header is rejected (it isn't signed by Cloudflare)
curl -i -H "Cf-Access-Jwt-Assertion: forged" http://localhost:5000/api/wrapped
# -> 401
```

Then through Cloudflare: open `https://wrapped.example.com` in a browser —
you get the Cloudflare login page, enter your email, receive the PIN, and
after login the app loads and the badge in the top-right shows your email
(`/api/auth/me` now returns `authenticated: true`).

Automated coverage lives in
[server/services/cloudflare-access.test.ts](server/services/cloudflare-access.test.ts)
(`npm test`): valid tokens accepted; missing/forged/expired/wrong-audience/
wrong-issuer/wrong-algorithm tokens rejected with 401; dev-bypass only works
when explicitly enabled; `/api/auth/me` exposes exactly the email and nothing
else.

## Security notes

- OTP codes and passwords never touch the app or its database.
- Tokens are never logged — only generic rejection reasons are.
- `SESSION_SECRET` is still unused; Cloudflare's session cookie replaces any
  need for app-side sessions.
- `AUTH_MODE=disabled` remains the default so existing LAN deployments keep
  working, but any internet-facing deployment (Cloudflare Tunnel, ngrok, port
  forward) should set `AUTH_MODE=cloudflare-access`. In production the server
  logs a prominent warning when auth is disabled.
