import { describe, expect, it } from "vitest";
import { login, register } from "../../src/routes/auth";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";

const SECRET = "test-secret-not-real";

function envFrom(db: FakeD1): Env {
  return { DB: asD1(db), WORKER_SESSION_SECRET: SECRET } as unknown as Env;
}

function registerCtx(db: FakeD1, email: string, password: string, ip = "1.2.3.4"): Ctx {
  return {
    env: envFrom(db),
    req: new Request("https://x/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ email, password }),
    }),
    params: {},
  };
}

function loginCtx(db: FakeD1, email: string, password: string, ip = "1.2.3.4"): Ctx {
  return {
    env: envFrom(db),
    req: new Request("https://x/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ email, password }),
    }),
    params: {},
  };
}

describe("POST /api/auth/register", () => {
  it("creates a user row and returns a session token", async () => {
    const db = new FakeD1();
    const res = await register(registerCtx(db, "parent@example.com", "correcthorse"));
    const body = (await res.json()) as { user_id: string; is_admin: boolean; session_token: string };
    expect(res.status).toBe(200);
    expect(body.user_id).toBeTruthy();
    expect(body.session_token).toBeTruthy();
    expect(db.users.size).toBe(1);
    const user = [...db.users.values()][0]!;
    expect(user.password_hash).toBeTruthy();
    expect(user.password_hash!.startsWith("pbkdf2-sha256$")).toBe(true);
  });

  it("refuses a short password with 400 password_length", async () => {
    const db = new FakeD1();
    await expect(register(registerCtx(db, "parent@example.com", "short"))).rejects.toMatchObject({
      status: 400,
      code: "password_length",
    });
    expect(db.users.size).toBe(0);
  });

  it("refuses a malformed email with 400 email_invalid", async () => {
    const db = new FakeD1();
    await expect(register(registerCtx(db, "notanemail", "correcthorse"))).rejects.toMatchObject({
      status: 400,
      code: "email_invalid",
    });
  });

  it("refuses a duplicate email with 400 email_in_use", async () => {
    const db = new FakeD1();
    await register(registerCtx(db, "parent@example.com", "correcthorse"));
    await expect(
      register(registerCtx(db, "parent@example.com", "anotherone")),
    ).rejects.toMatchObject({ status: 400, code: "email_in_use" });
    expect(db.users.size).toBe(1);
  });
});

describe("POST /api/auth/login", () => {
  it("accepts the same password it was registered with", async () => {
    const db = new FakeD1();
    await register(registerCtx(db, "parent@example.com", "correcthorse"));
    const res = await login(loginCtx(db, "parent@example.com", "correcthorse"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user_id: string; session_token: string };
    expect(body.session_token).toBeTruthy();
  });

  it("returns 401 invalid_credentials for a wrong password", async () => {
    const db = new FakeD1();
    await register(registerCtx(db, "parent@example.com", "correcthorse"));
    await expect(
      login(loginCtx(db, "parent@example.com", "wrong-password")),
    ).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
  });

  it("returns the same 401 invalid_credentials for an unknown email (no enumeration)", async () => {
    const db = new FakeD1();
    await expect(
      login(loginCtx(db, "stranger@example.com", "correcthorse")),
    ).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
  });

  it("is case-insensitive and whitespace-tolerant on the email", async () => {
    const db = new FakeD1();
    await register(registerCtx(db, "Parent@Example.com", "correcthorse"));
    const res = await login(loginCtx(db, "  parent@example.COM  ", "correcthorse"));
    expect(res.status).toBe(200);
  });
});
