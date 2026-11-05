import { describe, expect, it } from "vitest";
import { mediaUrl, signMediaPath, verifyMediaSignature } from "../../src/storage/signed";
import { get } from "../../src/routes/reels";
import { signSessionId, SESSION_COOKIE } from "../../src/auth/session";
import { sha256Hex } from "../../src/util/hash";
import type { Ctx } from "../../src/router";
import type { Env } from "../../src/env";
import { asD1, FakeD1 } from "./fake-d1";
import { asR2, FakeR2 } from "./fake-r2";

const SECRET = "test-secret-not-real";
const USER = "user_1";

describe("signed media URLs (H-8/H-9)", () => {
  it("round-trips a signature", async () => {
    const { path, exp } = await signMediaPath(SECRET, "reels/r1/shot-1.png", 3600, 0);
    const sig = new URL(`https://x${path}`).searchParams.get("sig")!;
    expect(path).toBe(`/api/media/reels/r1/shot-1.png?exp=${exp}&sig=${sig}`);
    await expect(verifyMediaSignature(SECRET, "reels/r1/shot-1.png", exp, sig, 0)).resolves.toBe(true);
  });

  it("rejects a tampered key, a wrong secret, and an expired sig", async () => {
    const { path, exp } = await signMediaPath(SECRET, "reels/r1/shot-1.png", 3600, 0);
    const sig = new URL(`https://x${path}`).searchParams.get("sig")!;

    await expect(verifyMediaSignature(SECRET, "reels/r2/shot-1.png", exp, sig, 0)).resolves.toBe(false);
    await expect(verifyMediaSignature("other", "reels/r1/shot-1.png", exp, sig, 0)).resolves.toBe(false);
    await expect(verifyMediaSignature(SECRET, "reels/r1/shot-1.png", exp, sig, exp * 1000)).resolves.toBe(false);
  });

  it("mediaUrl builds an absolute https URL on the configured base", async () => {
    const env = { WORKER_SESSION_SECRET: SECRET, PUBLIC_API_BASE: "https://api.example.dev" } as unknown as Env;
    const url = await mediaUrl(env, "reels/r1/shot-1.png", 0);
    expect(url.startsWith("https://api.example.dev/api/media/reels/r1/shot-1.png?exp=")).toBe(true);
  });

  it("reels.get returns signed keyframe_url/video_url, never raw R2 keys", async () => {
    const db = new FakeD1();
    const r2 = new FakeR2();
    db.users.set(USER, { id: USER, is_admin: 0 });
    const sessionKey = await sha256Hex("sess_1");
    db.sessions.set(sessionKey, { id: sessionKey, user_id: USER, expires_at: Date.now() + 1e9 });
    db.reels.set("r1", { id: "r1", user_id: USER, kid_id: "kid_1", status: "done", tier: "hd", story: "s", created_at: 1 });
    await r2.put(
      "reels/r1/shots.json",
      JSON.stringify([
        { index: 1, caption: "c", keyframe_key: "reels/r1/shot-1.png", video_key: "reels/r1/shot-1.mp4" },
      ]),
    );

    const env = {
      DB: asD1(db),
      R2: asR2(r2),
      WORKER_SESSION_SECRET: SECRET,
      PUBLIC_API_BASE: "https://api.example.dev",
    } as unknown as Env;
    const sig = await signSessionId(SECRET, "sess_1");
    const req = new Request("https://x/api/reels/r1", {
      headers: { Cookie: `${SESSION_COOKIE}=sess_1.${sig}` },
    });

    const res = await get({ env, req, params: { id: "r1" } } as Ctx);
    const body = (await res.json()) as { shots: { keyframe_url: string; video_url: string }[] };

    expect(body.shots[0]!.keyframe_url).toMatch(/^https:\/\/api\.example\.dev\/api\/media\/reels\/r1\/shot-1\.png\?exp=/);
    expect(body.shots[0]!.video_url).toMatch(/^https:\/\/api\.example\.dev\/api\/media\/reels\/r1\/shot-1\.mp4\?exp=/);
    expect(JSON.stringify(body)).not.toContain("keyframe_key");
  });
});
