import { describe, expect, it } from "vitest";
import { BadRequest, errorResponse } from "../../src/util/errors";

describe("error envelope (T2)", () => {
  it("uses the BadRequest code as the wire error code (photo_too_small)", async () => {
    const res = errorResponse(new BadRequest("photo_too_small"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "photo_too_small" });
  });

  it("keeps the default bad_request code and status", async () => {
    const res = errorResponse(new BadRequest());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "bad_request" });
  });
});
