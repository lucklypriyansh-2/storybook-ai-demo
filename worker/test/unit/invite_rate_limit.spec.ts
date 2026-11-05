import { describe, expect, it } from "vitest";
import { invite } from "../../src/routes/auth";
import { INVITE_LIMITS } from "../../src/config/limits";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { RateLimited } from "../../src/util/errors";
import { asD1, FakeD1 } from "./fake-d1";

function ctxFor(db: FakeD1, ip: string): Ctx {
  const env = { DB: asD1(db), WORKER_SESSION_SECRET: "test" } as unknown as Env;
  const req = new Request("https://x/api/auth/invite", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ code: "nope", email: "x@example.com" }),
  });
  return { env, req, params: {} };
}

describe("invite rate limit (H-5)", () => {
  it("rate-limits after the per-IP hourly budget is spent", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 999, used_count: 0, note: null });
    const ctx = ctxFor(db, "9.9.9.9");
    // Rewrite the body to a valid code so the limiter, not the code check, decides.
    const valid = async () => {
      const req = new Request("https://x/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": "9.9.9.9" },
        body: JSON.stringify({ code: "FAMILY", email: "x@example.com" }),
      });
      return { ...ctx, req };
    };

    for (let i = 0; i < INVITE_LIMITS.perHour; i++) await invite(await valid());
    await expect(invite(await valid())).rejects.toBeInstanceOf(RateLimited);
  });

  it("keys the bucket by IP so one attacker cannot exhaust another's budget", async () => {
    const db = new FakeD1();
    db.invites.set("FAMILY", { code: "FAMILY", max_uses: 999, used_count: 0, note: null });

    const post = (ip: string, email: string) =>
      invite({
        env: { DB: asD1(db), WORKER_SESSION_SECRET: "test" } as unknown as Env,
        req: new Request("https://x/api/auth/invite", {
          method: "POST",
          headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify({ code: "FAMILY", email }),
        }),
        params: {},
      });

    for (let i = 0; i < INVITE_LIMITS.perHour; i++) await post("1.1.1.1", `a${i}@e.com`);
    await expect(post("1.1.1.1", "blocked@e.com")).rejects.toBeInstanceOf(RateLimited);
    // A different IP still has its own budget.
    await expect(post("2.2.2.2", "ok@e.com")).resolves.toMatchObject({ status: 200 });
  });
});
