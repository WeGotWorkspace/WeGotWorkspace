import { describe, expect, it } from "vitest";
import { hexToOklch, syncSchemeColors } from "./sync-scheme-colors.mjs";

describe("scheme colours: one source", () => {
  it("has every generated copy in step with scheme-colors.json", () => {
    // Fails with the stale file names; fix with `pnpm sync:scheme-colors`.
    expect(syncSchemeColors({ check: true })).toEqual([]);
  });

  it("spells the hue out for near-neutral dark colours", () => {
    expect(hexToOklch("#0e1216")).toMatch(/^oklch\([\d.]+ [\d.]+ \d+(\.\d+)?\)$/);
  });
});
