import { describe, expect, it } from "vitest";
import { invite } from "../../src/routes/auth";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";

const SECRET = "test-secret-not-real";

function envFrom(db: FakeD1): Env {
  return { DB: asD1(db), WORKER_SESSION_SECRET: SECRET } as unknown as Env;
}

function reqFor(email: string, ip = "1.2.3.4"): Request {
  return new Request("https://x/api/auth/invite", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ code: "FAMILY", email }),
  });
}

async function callInvite(db: FakeD1, email: string, ip = "1.2.3.4"): Promise<Ctx> {
  const ctx: Ctx = { env: envFrom(db), req: reqFor(email, ip), params: {} };
  return ctx;
}

describe("POST /api/auth/invite — invite consumption (H-1)", () => {
  it("does not burn a use when a returning user logs back in", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 5, used_count: 0, note: null });

    await invite(await callInvite(db, "parent@example.com"));
    expect(db.invites.get("FAMILY")?.used_count).toBe(1);

    // Same email again: existing user, validated but not consumed.
    await invite(await callInvite(db, "parent@example.com"));
    await invite(await callInvite(db, "parent@example.com"));
    expect(db.invites.get("FAMILY")?.used_count).toBe(1);
    expect(db.users.size).toBe(1);
  });

  it("still burns a use for a genuinely new email", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 5, used_count: 0, note: null });

    await invite(await callInvite(db, "a@example.com"));
    await invite(await callInvite(db, "b@example.com"));

    expect(db.invites.get("FAMILY")?.used_count).toBe(2);
  });

  it("rejects an exhausted code for a brand-new user", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 1, used_count: 1, note: null });

    await expect(invite(await callInvite(db, "new@example.com"))).rejects.toMatchObject({
      status: 401,
    });
    expect(db.users.size).toBe(0);
  });
});
