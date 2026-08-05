/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredSharePassword,
  normalizeSharePasswordScope,
  readStoredSharePassword,
  sharePasswordStorageKey,
  writeStoredSharePassword,
} from "@/share-ui/share-password-storage";

const SCOPE = "/docs/report.md";

afterEach(() => {
  sessionStorage.removeItem(sharePasswordStorageKey(SCOPE));
  sessionStorage.removeItem(sharePasswordStorageKey("docs/report.md"));
  sessionStorage.removeItem(sharePasswordStorageKey("/docs/report.md/"));
});

describe("share-password-storage", () => {
  it("writes and reads a password for a scope", () => {
    writeStoredSharePassword(SCOPE, "river-maple-42");
    expect(readStoredSharePassword(SCOPE)).toBe("river-maple-42");
  });

  it("normalizes path variants to the same storage key", () => {
    writeStoredSharePassword("docs/report.md/", "river-maple-42");
    expect(readStoredSharePassword("/docs/report.md")).toBe("river-maple-42");
    expect(readStoredSharePassword("docs/report.md")).toBe("river-maple-42");
    expect(normalizeSharePasswordScope("docs/report.md/")).toBe("/docs/report.md");
    expect(sharePasswordStorageKey("docs/report.md")).toBe(
      sharePasswordStorageKey("/docs/report.md/"),
    );
  });

  it("clears a stored password", () => {
    writeStoredSharePassword(SCOPE, "river-maple-42");
    clearStoredSharePassword(SCOPE);
    expect(readStoredSharePassword(SCOPE)).toBe("");
  });

  it("returns empty when scope is missing", () => {
    expect(readStoredSharePassword(undefined)).toBe("");
  });
});
