import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Request, Response } from "express";

import {
  createAuth,
  normalizeTeamDomain,
  verifyAccessToken,
  type Jwks,
} from "./cloudflare-access";

// ---------------------------------------------------------------------------
// Fixture builders — a real RSA key pair and a minimal JWT signer, so tokens
// are verified with the same crypto path production uses.
// ---------------------------------------------------------------------------

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKeyPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

const KID = "test-key";
const TEAM_DOMAIN = "myteam.cloudflareaccess.com";
const ISSUER = `https://${TEAM_DOMAIN}`;
const AUD = "a".repeat(64);
const NOW = 1_750_000_000; // fixed "current time" in seconds

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signJwt(
  payload: Record<string, unknown>,
  opts: { kid?: string | null; alg?: string; key?: crypto.KeyObject; tamper?: boolean } = {},
): string {
  const header: Record<string, unknown> = { alg: opts.alg ?? "RS256", typ: "JWT" };
  if (opts.kid !== null) header.kid = opts.kid ?? KID;
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  let signature = "";
  if (header.alg !== "none") {
    signature = crypto.sign("sha256", Buffer.from(`${h}.${p}`), opts.key ?? privateKey).toString("base64url");
  }
  if (opts.tamper) {
    // Flip the payload after signing so the signature no longer matches.
    return `${h}.${b64url(JSON.stringify({ ...payload, email: "attacker@evil.io" }))}.${signature}`;
  }
  return `${h}.${p}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "user@example.com",
    iss: ISSUER,
    aud: AUD,
    iat: NOW - 60,
    nbf: NOW - 60,
    exp: NOW + 3600,
    sub: "user-id",
    ...overrides,
  };
}

const getKey = (kid: string) => (kid === KID ? publicKey : undefined);
const verifyOpts = { audience: AUD, issuer: ISSUER, getKey, nowSeconds: NOW };

function jwksOf(key: crypto.KeyObject, kid = KID): Jwks {
  return { keys: [{ ...(key.export({ format: "jwk" }) as crypto.JsonWebKey), kid }] };
}

// Minimal express Request/Response stand-ins for middleware tests.
function fakeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as typeof res & Response;
}

const cloudflareEnv = {
  AUTH_MODE: "cloudflare-access",
  CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  CF_ACCESS_AUD: AUD,
} satisfies NodeJS.ProcessEnv;

// ---------------------------------------------------------------------------
// verifyAccessToken
// ---------------------------------------------------------------------------

describe("verifyAccessToken", () => {
  test("accepts a valid token and returns its claims", async () => {
    const claims = await verifyAccessToken(signJwt(validClaims()), verifyOpts);
    assert.equal(claims.email, "user@example.com");
    assert.equal(claims.iss, ISSUER);
  });

  test("accepts aud provided as an array containing the audience", async () => {
    const claims = await verifyAccessToken(signJwt(validClaims({ aud: [AUD, "other"] })), verifyOpts);
    assert.equal(claims.email, "user@example.com");
  });

  test("rejects a tampered payload (signature mismatch)", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims(), { tamper: true }), verifyOpts),
      /Invalid token signature/,
    );
  });

  test("rejects a token signed with a different key", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims(), { key: otherKeyPair.privateKey }), verifyOpts),
      /Invalid token signature/,
    );
  });

  test("rejects an expired token", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims({ exp: NOW - 3600 })), verifyOpts),
      /Token expired/,
    );
  });

  test("rejects a token that is not yet valid", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims({ nbf: NOW + 3600 })), verifyOpts),
      /Token not yet valid/,
    );
  });

  test("rejects a wrong audience", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims({ aud: "b".repeat(64) })), verifyOpts),
      /Unexpected token audience/,
    );
  });

  test("rejects a wrong issuer", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims({ iss: "https://evil.cloudflareaccess.com" })), verifyOpts),
      /Unexpected token issuer/,
    );
  });

  test("rejects alg=none", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims(), { alg: "none" }), verifyOpts),
      /Unexpected token algorithm/,
    );
  });

  test("rejects non-RS256 algorithms", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims(), { alg: "HS256" }), verifyOpts),
      /Unexpected token algorithm/,
    );
  });

  test("rejects a token with an unknown kid", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims(), { kid: "unknown-kid" }), verifyOpts),
      /Unknown signing key/,
    );
  });

  test("rejects a token without a kid", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims(), { kid: null }), verifyOpts),
      /Token has no key id/,
    );
  });

  test("rejects a token without an email claim", async () => {
    await assert.rejects(
      verifyAccessToken(signJwt(validClaims({ email: undefined })), verifyOpts),
      /Token has no email claim/,
    );
  });

  test("rejects garbage tokens", async () => {
    await assert.rejects(verifyAccessToken("not-a-jwt", verifyOpts), /Malformed token/);
    await assert.rejects(verifyAccessToken("a.b.c", verifyOpts), /Malformed token/);
    await assert.rejects(verifyAccessToken("", verifyOpts), /Malformed token/);
  });
});

// ---------------------------------------------------------------------------
// normalizeTeamDomain
// ---------------------------------------------------------------------------

describe("normalizeTeamDomain", () => {
  test("expands a bare team name", () => {
    assert.equal(normalizeTeamDomain("myteam"), "myteam.cloudflareaccess.com");
  });

  test("keeps a full domain and strips protocol/trailing slash", () => {
    assert.equal(normalizeTeamDomain("myteam.cloudflareaccess.com"), "myteam.cloudflareaccess.com");
    assert.equal(normalizeTeamDomain("https://myteam.cloudflareaccess.com/"), "myteam.cloudflareaccess.com");
  });
});

// ---------------------------------------------------------------------------
// createAuth — configuration validation
// ---------------------------------------------------------------------------

describe("createAuth configuration", () => {
  test("defaults to disabled when AUTH_MODE is unset", () => {
    assert.equal(createAuth({}).mode, "disabled");
  });

  test("rejects an unknown AUTH_MODE", () => {
    assert.throws(() => createAuth({ AUTH_MODE: "basic" }), /Invalid AUTH_MODE/);
  });

  test("cloudflare-access requires team domain and audience", () => {
    assert.throws(() => createAuth({ AUTH_MODE: "cloudflare-access" }), /CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD/);
    assert.throws(
      () => createAuth({ AUTH_MODE: "cloudflare-access", CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN }),
      /CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD/,
    );
    assert.equal(createAuth(cloudflareEnv).mode, "cloudflare-access");
  });

  test("dev-bypass requires DEV_AUTH_EMAIL", () => {
    assert.throws(() => createAuth({ AUTH_MODE: "dev-bypass" }), /requires DEV_AUTH_EMAIL/);
  });

  test("dev-bypass refuses to run in production", () => {
    assert.throws(
      () => createAuth({ AUTH_MODE: "dev-bypass", DEV_AUTH_EMAIL: "dev@example.com", NODE_ENV: "production" }),
      /refuses to run with NODE_ENV=production/,
    );
  });
});

// ---------------------------------------------------------------------------
// createAuth — middleware behaviour
// ---------------------------------------------------------------------------

describe("auth middleware (cloudflare-access)", () => {
  const fetchJwks = async () => jwksOf(publicKey);

  test("rejects a request without a token with 401", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks });
    const res = fakeRes();
    let nextCalled = false;
    await auth.middleware(fakeReq(), res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "Authentication required" });
  });

  test("rejects an invalid/forged token with 401", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks });
    const res = fakeRes();
    let nextCalled = false;
    const forged = signJwt(validClaims(), { key: otherKeyPair.privateKey });
    await auth.middleware(fakeReq({ "cf-access-jwt-assertion": forged }), res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  test("rejects an expired token with 401", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks });
    const res = fakeRes();
    const expired = signJwt(validClaims({ exp: Math.floor(Date.now() / 1000) - 3600 }));
    await auth.middleware(fakeReq({ "cf-access-jwt-assertion": expired }), res, () => {
      assert.fail("next must not be called");
    });
    assert.equal(res.statusCode, 401);
  });

  test("accepts a valid token and attaches the verified email", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks });
    const res = fakeRes();
    let nextCalled = false;
    const token = signJwt({ ...validClaims(), exp: Math.floor(Date.now() / 1000) + 3600 });
    const req = fakeReq({ "cf-access-jwt-assertion": token });
    await auth.middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(req.authEmail, "user@example.com");
  });

  test("accepts the token from the CF_Authorization cookie", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks });
    const res = fakeRes();
    let nextCalled = false;
    const token = signJwt({ ...validClaims(), exp: Math.floor(Date.now() / 1000) + 3600 });
    const req = fakeReq({ cookie: `other=1; CF_Authorization=${token}` });
    await auth.middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.authEmail, "user@example.com");
  });

  test("rejects with 401 when the JWKS endpoint is unreachable", async () => {
    const auth = createAuth(cloudflareEnv, {
      fetchJwks: async () => {
        throw new Error("network down");
      },
    });
    const res = fakeRes();
    const token = signJwt({ ...validClaims(), exp: Math.floor(Date.now() / 1000) + 3600 });
    await auth.middleware(fakeReq({ "cf-access-jwt-assertion": token }), res, () => {
      assert.fail("next must not be called");
    });
    assert.equal(res.statusCode, 401);
  });
});

describe("auth middleware (other modes)", () => {
  test("disabled mode passes requests through without an identity", async () => {
    const auth = createAuth({ AUTH_MODE: "disabled" });
    const res = fakeRes();
    let nextCalled = false;
    const req = fakeReq();
    await auth.middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.authEmail, undefined);
  });

  test("dev-bypass injects the configured email only when explicitly enabled", async () => {
    const auth = createAuth({ AUTH_MODE: "dev-bypass", DEV_AUTH_EMAIL: "dev@example.com" });
    const res = fakeRes();
    let nextCalled = false;
    const req = fakeReq();
    await auth.middleware(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.authEmail, "dev@example.com");

    // Without the explicit mode, the same env email must have no effect.
    const defaultAuth = createAuth({ DEV_AUTH_EMAIL: "dev@example.com" });
    assert.equal(defaultAuth.mode, "disabled");
    const user = await defaultAuth.getUser(fakeReq());
    assert.equal(user, null);
  });
});

// ---------------------------------------------------------------------------
// /api/auth/me handler
// ---------------------------------------------------------------------------

describe("meHandler", () => {
  test("reports the authenticated user's email", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks: async () => jwksOf(publicKey) });
    const res = fakeRes();
    const token = signJwt({ ...validClaims(), exp: Math.floor(Date.now() / 1000) + 3600 });
    await auth.meHandler(fakeReq({ "cf-access-jwt-assertion": token }), res);
    assert.deepEqual(res.body, {
      authenticated: true,
      email: "user@example.com",
      mode: "cloudflare-access",
    });
  });

  test("reports unauthenticated without a valid token (still 200, no secrets)", async () => {
    const auth = createAuth(cloudflareEnv, { fetchJwks: async () => jwksOf(publicKey) });
    const res = fakeRes();
    await auth.meHandler(fakeReq(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { authenticated: false, email: null, mode: "cloudflare-access" });
  });

  test("reports disabled mode as unauthenticated", async () => {
    const auth = createAuth({});
    const res = fakeRes();
    await auth.meHandler(fakeReq(), res);
    assert.deepEqual(res.body, { authenticated: false, email: null, mode: "disabled" });
  });

  test("reports the dev-bypass email", async () => {
    const auth = createAuth({ AUTH_MODE: "dev-bypass", DEV_AUTH_EMAIL: "dev@example.com" });
    const res = fakeRes();
    await auth.meHandler(fakeReq(), res);
    assert.deepEqual(res.body, { authenticated: true, email: "dev@example.com", mode: "dev-bypass" });
  });
});
