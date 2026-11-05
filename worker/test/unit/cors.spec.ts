import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_ORIGIN, preflight, withCors } from "../../src/cors";
import type { Env } from "../../src/env";

const env = {} as Env;
const envWithOrigin = { ALLOWED_ORIGIN: "https://staging.example.dev" } as unknown as Env;

describe("CORS layer (H-4)", () => {
  it("short-circuits OPTIONS with 204 and the configured origin", async () => {
    const res = preflight(env, new Request("https://api/x", { method: "OPTIONS" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(204);
    expect(res!.headers.get("Access-Control-Allow-Origin")).toBe(DEFAULT_ALLOWED_ORIGIN);
    expect(res!.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res!.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    // Catalog page saves need PATCH/DELETE and the bootstrap header must survive preflight.
    expect(res!.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
    expect(res!.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
    expect(res!.headers.get("Access-Control-Allow-Headers")).toContain("x-admin-token");
  });

  it("honors an ALLOWED_ORIGIN override", () => {
    const res = preflight(envWithOrigin, new Request("https://api/x", { method: "OPTIONS" }));
    expect(res!.headers.get("Access-Control-Allow-Origin")).toBe("https://staging.example.dev");
  });

  it("returns null for a non-preflight request so dispatch proceeds", () => {
    expect(preflight(env, new Request("https://api/x"))).toBeNull();
  });

  it("echoes the origin + credentials onto a normal response", () => {
    const wrapped = withCors(env, Response.json({ ok: true }));
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe(DEFAULT_ALLOWED_ORIGIN);
    expect(wrapped.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});
