import crypto from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

// Cloudflare Access authentication for Project-Wrapped.
//
// The app is placed behind Cloudflare Zero Trust / Cloudflare Access, which
// handles the email + one-time-PIN login flow at the edge and forwards each
// authenticated request with a signed JWT in the `Cf-Access-Jwt-Assertion`
// header (also available as the `CF_Authorization` cookie). This module
// verifies that JWT against the team's public signing keys (JWKS) so the
// backend only trusts identities that Cloudflare actually authenticated -
// never a client-supplied header on its own. See AUTHENTICATION.md.
//
// No passwords or OTP codes are ever handled or stored by the app, and token
// values are never logged.

export type AuthMode = "cloudflare-access" | "dev-bypass" | "disabled";

export interface AuthUser {
  email: string;
}

export interface AccessJwtClaims {
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  [claim: string]: unknown;
}

export interface Jwks {
  keys: Array<crypto.JsonWebKey & { kid?: string }>;
}

export interface VerifyOptions {
  // The Access application's Audience (AUD) tag.
  audience: string;
  // Expected issuer, e.g. https://myteam.cloudflareaccess.com
  issuer: string;
  // Resolves a signing key by `kid`; returns undefined when unknown.
  getKey: (kid: string) => Promise<crypto.KeyObject | undefined> | crypto.KeyObject | undefined;
  // Current time in seconds since epoch (injectable for tests).
  nowSeconds?: number;
  // Allowed clock skew when checking exp/nbf.
  leewaySeconds?: number;
}

export interface Auth {
  mode: AuthMode;
  // Resolves the authenticated user for a request, or null. Never throws.
  getUser(req: Request): Promise<AuthUser | null>;
  // Rejects requests without a verified Cloudflare Access identity (401).
  middleware: RequestHandler;
  // Handler for GET /api/auth/me - reports auth state, never any secrets.
  meHandler(req: Request, res: Response): Promise<void>;
}

declare global {
  namespace Express {
    interface Request {
      // Verified email of the authenticated user (set by the auth middleware).
      authEmail?: string;
    }
  }
}

function decodeJwtSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed token");
  }
}

// Verifies a Cloudflare Access JWT: RS256 signature against the team's JWKS,
// then issuer, audience, expiry and not-before claims. Throws on any failure;
// error messages never contain token material.
export async function verifyAccessToken(token: string, options: VerifyOptions): Promise<AccessJwtClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    throw new Error("Malformed token");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = decodeJwtSegment(headerB64) as { alg?: unknown; kid?: unknown };
  if (typeof header !== "object" || header === null) {
    throw new Error("Malformed token header");
  }
  // Only the algorithm Cloudflare Access actually uses is accepted - this
  // rules out alg-confusion attacks ("none", HS256 with a public key, etc.).
  if (header.alg !== "RS256") {
    throw new Error("Unexpected token algorithm");
  }
  if (typeof header.kid !== "string" || !header.kid) {
    throw new Error("Token has no key id");
  }

  const key = await options.getKey(header.kid);
  if (!key) {
    throw new Error("Unknown signing key");
  }

  const signature = Buffer.from(signatureB64, "base64url");
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
  if (signature.length === 0 || !crypto.verify("sha256", signedData, key, signature)) {
    throw new Error("Invalid token signature");
  }

  const claims = decodeJwtSegment(payloadB64) as AccessJwtClaims;
  if (typeof claims !== "object" || claims === null) {
    throw new Error("Malformed token payload");
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const leeway = options.leewaySeconds ?? 60;

  if (claims.iss !== options.issuer) {
    throw new Error("Unexpected token issuer");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) {
    throw new Error("Unexpected token audience");
  }
  if (typeof claims.exp !== "number" || now >= claims.exp + leeway) {
    throw new Error("Token expired");
  }
  if (typeof claims.nbf === "number" && now < claims.nbf - leeway) {
    throw new Error("Token not yet valid");
  }
  // One-Time PIN logins always carry the authenticated email. Tokens without
  // one (e.g. service tokens) are deliberately not accepted as users.
  if (typeof claims.email !== "string" || !claims.email) {
    throw new Error("Token has no email claim");
  }

  return claims;
}

// Normalizes CF_ACCESS_TEAM_DOMAIN: accepts "myteam",
// "myteam.cloudflareaccess.com" or a full https:// URL.
export function normalizeTeamDomain(value: string): string {
  let domain = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (domain && !domain.includes(".")) {
    domain = `${domain}.cloudflareaccess.com`;
  }
  return domain;
}

function extractToken(req: Request): string | undefined {
  const header = req.headers["cf-access-jwt-assertion"];
  if (typeof header === "string" && header) {
    return header;
  }
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === "string") {
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === "CF_Authorization") {
        return part.slice(eq + 1).trim() || undefined;
      }
    }
  }
  return undefined;
}

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
// Minimum interval between forced refreshes triggered by an unknown kid, so
// bogus tokens can't make the server hammer the JWKS endpoint.
const JWKS_REFRESH_MIN_INTERVAL_MS = 30 * 1000;

async function defaultFetchJwks(url: string): Promise<Jwks> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with status ${response.status}`);
  }
  return (await response.json()) as Jwks;
}

interface AuthDeps {
  fetchJwks?: (url: string) => Promise<Jwks>;
}

// Builds the app's auth layer from environment variables. Validates the
// configuration eagerly so a misconfigured deployment fails at startup
// instead of silently running unprotected.
export function createAuth(env: NodeJS.ProcessEnv, deps: AuthDeps = {}): Auth {
  const mode = (env.AUTH_MODE || "disabled").trim().toLowerCase() as AuthMode;
  const isProduction = env.NODE_ENV === "production";

  if (!["cloudflare-access", "dev-bypass", "disabled"].includes(mode)) {
    throw new Error(`Invalid AUTH_MODE "${env.AUTH_MODE}" - expected cloudflare-access, dev-bypass or disabled`);
  }

  if (mode === "dev-bypass" && isProduction) {
    throw new Error("AUTH_MODE=dev-bypass is a local-development mode and refuses to run with NODE_ENV=production");
  }

  const devEmail = env.DEV_AUTH_EMAIL?.trim() || "";
  if (mode === "dev-bypass" && !devEmail) {
    throw new Error("AUTH_MODE=dev-bypass requires DEV_AUTH_EMAIL to be set");
  }

  let issuer = "";
  let audience = "";
  let jwksUrl = "";
  if (mode === "cloudflare-access") {
    const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN || "");
    audience = env.CF_ACCESS_AUD?.trim() || "";
    if (!teamDomain || !audience) {
      throw new Error("AUTH_MODE=cloudflare-access requires CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD to be set");
    }
    issuer = `https://${teamDomain}`;
    jwksUrl = `${issuer}/cdn-cgi/access/certs`;
  }

  if (mode === "disabled" && isProduction) {
    console.warn(
      "[auth] WARNING: AUTH_MODE=disabled - every route is reachable without authentication. " +
        "Only acceptable on a trusted LAN; for any internet-facing deployment set AUTH_MODE=cloudflare-access (see AUTHENTICATION.md).",
    );
  }

  const fetchJwks = deps.fetchJwks ?? defaultFetchJwks;
  let jwksCache: { keys: Map<string, crypto.KeyObject>; fetchedAt: number } | null = null;

  async function loadJwks(force: boolean): Promise<Map<string, crypto.KeyObject>> {
    const age = jwksCache ? Date.now() - jwksCache.fetchedAt : Infinity;
    const stale = age > JWKS_CACHE_TTL_MS;
    const refreshAllowed = age > JWKS_REFRESH_MIN_INTERVAL_MS;
    if (!jwksCache || stale || (force && refreshAllowed)) {
      const jwks = await fetchJwks(jwksUrl);
      const keys = new Map<string, crypto.KeyObject>();
      for (const jwk of jwks.keys ?? []) {
        if (typeof jwk.kid !== "string" || !jwk.kid) continue;
        try {
          keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
        } catch {
          // Skip keys that can't be imported rather than failing the whole set.
        }
      }
      jwksCache = { keys, fetchedAt: Date.now() };
    }
    return jwksCache.keys;
  }

  async function getKey(kid: string): Promise<crypto.KeyObject | undefined> {
    const keys = await loadJwks(false);
    if (keys.has(kid)) return keys.get(kid);
    // Cloudflare rotates its signing keys - refresh once on an unknown kid.
    return (await loadJwks(true)).get(kid);
  }

  async function getUser(req: Request): Promise<AuthUser | null> {
    if (mode === "dev-bypass") {
      return { email: devEmail };
    }
    if (mode === "disabled") {
      return null;
    }
    const token = extractToken(req);
    if (!token) return null;
    try {
      const claims = await verifyAccessToken(token, { audience, issuer, getKey });
      return { email: claims.email as string };
    } catch (error) {
      // The reason is safe to log (never contains token material); the token
      // itself must never be logged.
      console.warn(`[auth] Rejected request: ${error instanceof Error ? error.message : "verification failed"}`);
      return null;
    }
  }

  const middleware: RequestHandler = async (req, res, next) => {
    if (mode === "disabled") {
      next();
      return;
    }
    const user = await getUser(req);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.authEmail = user.email;
    next();
  };

  async function meHandler(req: Request, res: Response): Promise<void> {
    const user = await getUser(req);
    res.json({
      authenticated: Boolean(user),
      email: user?.email ?? null,
      mode,
    });
  }

  return { mode, getUser, middleware, meHandler };
}
