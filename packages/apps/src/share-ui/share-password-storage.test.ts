/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredSharePassword,
  readStoredSharePassword,
  sharePasswordStorageKey,
  writeStoredSharePassword,
} from "@/share-ui/share-password-storage";

const SCOPE = "/docs/report.md";

afterEach(() => {
  sessionStorage.removeItem(sharePasswordStorageKey(SCOPE));
});

describe("share-password-storage", () => {
  it("writes and reads a password for a scope", () => {
    writeStoredSharePassword(SCOPE, "river-maple-42");
    expect(readStoredSharePassword(SCOPE)).toBe("river-maple-42");
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
