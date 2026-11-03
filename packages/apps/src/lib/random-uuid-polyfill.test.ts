import { describe, expect, it } from "vitest";
import { installRandomUuidPolyfill, randomUuidFromBytes } from "@/lib/random-uuid-polyfill";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("random UUID polyfill", () => {
  it("formats 16 bytes as a version 4 UUID", () => {
    expect(randomUuidFromBytes(new Uint8Array(16).fill(0xff))).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    );
    expect(randomUuidFromBytes(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("adds randomUUID where only getRandomValues exists, as over plain http", () => {
    const insecure: { getRandomValues: Crypto["getRandomValues"]; randomUUID?: () => string } = {
      getRandomValues: (array) => globalThis.crypto.getRandomValues(array),
    };
    installRandomUuidPolyfill(insecure);

    const first = insecure.randomUUID!();
    expect(first).toMatch(UUID_V4);
    expect(insecure.randomUUID!()).not.toBe(first);
  });

  it("leaves the browser's own randomUUID alone", () => {
    const own = () => "own";
    const secure = { getRandomValues: globalThis.crypto.getRandomValues, randomUUID: own };
    installRandomUuidPolyfill(secure);

    expect(secure.randomUUID).toBe(own);
  });
});
