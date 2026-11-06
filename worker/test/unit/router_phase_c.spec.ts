import { describe, expect, it } from "vitest";
import { dispatch } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

/**
 * The Phase C routes are only real if the anchored router patterns reach them —
 * a handler test that calls the function directly proves nothing about dispatch.
 * These assert the *matched* path, using 401/403/404 outcomes that only the route
 * handler can produce (an unmatched path would be a bare `not_found`).
 */
function envFor(): Env {
  return {
    DB: asD1(new FakeD1()),
    R2: asR2(new FakeR2()),
    WORKER_SESSION_SECRET: "test",
    PUBLIC_API_BASE: "https://api.example.dev",
  } as unknown as Env;
}

async function call(method: string, path: string): Promise<{ status: number; error?: string }> {
  try {
    const res = await dispatch(envFor(), new Request(`https://x${path}`, { method }));
    return { status: res.status, error: ((await res.json()) as { error?: string }).error };
  } catch (e) {
    const err = e as { status?: number; code?: string };
    return { status: err.status ?? 500, error: err.code };
  }
}

describe("Phase C router dispatch", () => {
  it("matches PATCH /api/kids/:id/character_sheet/hints to its own handler", async () => {
    // Not the GET/POST sheet route: an unauthenticated PATCH reaches the hints
    // handler, which requires a session first.
    expect(await call("PATCH", "/api/kids/kid_1/character_sheet/hints")).toMatchObject({
      status: 401,
      error: "unauthorized",
    });
  });

  it("matches GET /api/admin/templates/:id/preview, not the :id detail route", async () => {
    // `preview` is admin-gated; the public-shaped detail route would 404 instead.
    expect(await call("GET", "/api/admin/templates/tpl_a/preview")).toMatchObject({
      status: 401,
      error: "unauthorized",
    });
    // The detail route still matches its own (shorter) path.
    expect(await call("GET", "/api/admin/templates/tpl_a")).toMatchObject({ status: 401 });
  });

  it("still matches the page PATCH and the reel list", async () => {
    expect(await call("PATCH", "/api/reels/r1/pages/3")).toMatchObject({ status: 401 });
    expect(await call("GET", "/api/reels")).toMatchObject({ status: 401 });
  });

  it("404s an unknown path rather than falling through to a neighbour", async () => {
    expect(await call("PATCH", "/api/kids/kid_1/character_sheet/nope")).toMatchObject({ status: 404 });
    expect(await call("GET", "/api/admin/templates/tpl_a/preview/extra")).toMatchObject({ status: 404 });
  });
});
