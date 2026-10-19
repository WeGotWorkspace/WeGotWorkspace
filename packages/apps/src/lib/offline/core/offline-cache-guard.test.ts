import { describe, expect, it } from "vitest";
import { guardOfflineCacheStep } from "@/lib/offline/core/offline-cache-guard";

describe("guardOfflineCacheStep", () => {
  it("resolves with the step value when it settles in time", async () => {
    await expect(guardOfflineCacheStep(Promise.resolve("cached"), null, 50)).resolves.toBe(
      "cached",
    );
  });

  it("resolves with the fallback when the step rejects", async () => {
    await expect(
      guardOfflineCacheStep(Promise.reject(new Error("UnknownError")), null, 50),
    ).resolves.toBeNull();
  });

  it("resolves with the fallback when the step never settles", async () => {
    await expect(guardOfflineCacheStep(new Promise(() => {}), null, 10)).resolves.toBeNull();
  });
});
