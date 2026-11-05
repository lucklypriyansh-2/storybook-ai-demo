import { describe, expect, it } from "vitest";
import {
  readSessionCookie,
  signSessionId,
  verifySessionCookie,
} from "../../src/auth/session";

const SECRET = "test-secret-not-real";

describe("session HMAC", () => {
  it("round-trips a signed session id", async () => {
    const id = "session-abc";
    const sig = await signSessionId(SECRET, id);
    await expect(verifySessionCookie(SECRET, `${id}.${sig}`)).resolves.toBe(id);
  });

  it("rejects a tampered signature", async () => {
    const sig = await signSessionId(SECRET, "session-abc");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    await expect(verifySessionCookie(SECRET, `session-abc.${flipped}`)).resolves.toBeNull();
  });

  it("rejects a tampered id with a valid old signature", async () => {
    const sig = await signSessionId(SECRET, "session-abc");
    await expect(verifySessionCookie(SECRET, `session-xyz.${sig}`)).resolves.toBeNull();
  });

  it("rejects a signature made with a different secret", async () => {
    const sig = await signSessionId("other-secret", "session-abc");
    await expect(verifySessionCookie(SECRET, `session-abc.${sig}`)).resolves.toBeNull();
  });

  it("rejects malformed cookies", async () => {
    await expect(verifySessionCookie(SECRET, null)).resolves.toBeNull();
    await expect(verifySessionCookie(SECRET, "no-dot")).resolves.toBeNull();
    await expect(verifySessionCookie(SECRET, ".abc")).resolves.toBeNull();
    await expect(verifySessionCookie(SECRET, "abc.")).resolves.toBeNull();
  });

  it("reads the session value out of a cookie header", () => {
    const req = new Request("https://example.com", {
      headers: { Cookie: "theme=dark; sb_session=id.sig; other=1" },
    });
    expect(readSessionCookie(req)).toBe("id.sig");
  });
});
