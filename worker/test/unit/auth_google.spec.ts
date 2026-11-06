import { describe, expect, it } from "vitest";
import { googleCallback, googleStart, providers } from "../../src/routes/auth";
import { makeState, profileFromIdToken, verifyState } from "../../src/auth/google";
import { toBase64Url } from "../../src/util/hash";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";

const SECRET = "test-secret-not-real";
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_REDIRECT_URI: "https://api.example.com/api/auth/google/callback",
};

function envFrom(db: FakeD1, overrides: Partial<Env> = {}): Env {
  return {
    DB: asD1(db),
    WORKER_SESSION_SECRET: SECRET,
    ...overrides,
  } as unknown as Env;
}

function ctxFor(db: FakeD1, url: string, overrides: Partial<Env> = {}): Ctx {
  return {
    env: envFrom(db, overrides),
    req: new Request(url),
    params: {},
  };
}

function b64Json(obj: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

function fakeIdToken(claims: Record<string, unknown>): string {
  return `${b64Json({ alg: "RS256" })}.${b64Json(claims)}.sig`;
}

describe("GET /api/auth/providers", () => {
  it("reports google=false when GOOGLE_CLIENT_ID is unset", async () => {
    const res = await providers(ctxFor(new FakeD1(), "https://x/api/auth/providers"));
    const body = (await res.json()) as { email: boolean; google: boolean; invite: boolean };
    expect(body.email).toBe(true);
    expect(body.invite).toBe(true);
    expect(body.google).toBe(false);
  });

  it("reports google=true when every Google env var is set", async () => {
    const res = await providers(ctxFor(new FakeD1(), "https://x/api/auth/providers", GOOGLE_ENV));
    const body = (await res.json()) as { google: boolean };
    expect(body.google).toBe(true);
  });
});

describe("GET /api/auth/google/start — never calls Google in tests", () => {
  it("503s when the provider is not configured", async () => {
    await expect(
      googleStart(ctxFor(new FakeD1(), "https://x/api/auth/google/start?return_to=/")),
    ).rejects.toMatchObject({ status: 503, code: "provider_disabled" });
  });

  it("302s to accounts.google.com with a signed state when configured", async () => {
    const res = await googleStart(
      ctxFor(new FakeD1(), "https://x/api/auth/google/start?return_to=https://app/", GOOGLE_ENV),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    const params = new URL(location).searchParams;
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("redirect_uri")).toBe(GOOGLE_ENV.GOOGLE_REDIRECT_URI);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid email");
    const state = params.get("state")!;
    expect(await verifyState(SECRET, state)).toBe("https://app/");
  });
});

describe("state signing round-trips and refuses tampering", () => {
  it("verifies its own signed state", async () => {
    const state = await makeState(SECRET, "/next");
    expect(await verifyState(SECRET, state)).toBe("/next");
  });

  it("rejects state signed with a different secret", async () => {
    const state = await makeState("other-secret", "/next");
    expect(await verifyState(SECRET, state)).toBe(null);
  });

  it("rejects garbage", async () => {
    expect(await verifyState(SECRET, "not.base64url")).toBe(null);
    expect(await verifyState(SECRET, null)).toBe(null);
  });
});

describe("Google id_token → profile", () => {
  it("extracts sub and email", () => {
    const token = fakeIdToken({
      sub: "1234567890",
      email: "Parent@Example.com",
      email_verified: true,
    });
    const profile = profileFromIdToken(token);
    expect(profile.sub).toBe("1234567890");
    expect(profile.email).toBe("parent@example.com");
    expect(profile.email_verified).toBe(true);
  });

  it("refuses a token missing sub or email", () => {
    expect(() => profileFromIdToken(fakeIdToken({ email: "x@y.com" }))).toThrow(
      /google_id_token_missing_claims/,
    );
    expect(() => profileFromIdToken(fakeIdToken({ sub: "x" }))).toThrow(
      /google_id_token_missing_claims/,
    );
  });

  it("refuses a malformed token", () => {
    expect(() => profileFromIdToken("not.a.jwt.at.all")).toThrow(/google_id_token_malformed/);
    expect(() => profileFromIdToken("one-segment")).toThrow(/google_id_token_malformed/);
  });
});

describe("GET /api/auth/google/callback", () => {
  it("503s when provider is not configured — never reaches Google", async () => {
    await expect(
      googleCallback(ctxFor(new FakeD1(), "https://x/api/auth/google/callback?code=abc&state=x")),
    ).rejects.toMatchObject({ status: 503, code: "provider_disabled" });
  });

  it("400s when code is missing", async () => {
    await expect(
      googleCallback(
        ctxFor(new FakeD1(), "https://x/api/auth/google/callback?state=x", GOOGLE_ENV),
      ),
    ).rejects.toMatchObject({ status: 400, code: "code_required" });
  });

  it("401s on a tampered state before calling Google", async () => {
    await expect(
      googleCallback(
        ctxFor(
          new FakeD1(),
          "https://x/api/auth/google/callback?code=abc&state=wrong",
          GOOGLE_ENV,
        ),
      ),
    ).rejects.toMatchObject({ status: 401, code: "state_invalid" });
  });
});
