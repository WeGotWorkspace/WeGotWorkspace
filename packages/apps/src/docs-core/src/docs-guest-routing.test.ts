import { describe, expect, it } from "vitest";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";

function shouldOpenDocsCollab(filePath: string | null, isGuestSession: boolean): boolean {
  return isDocsCollabEditablePath(filePath) && !isGuestSession;
}

describe("docs guest routing", () => {
  it("opens collab for signed-in markdown files", () => {
    expect(shouldOpenDocsCollab("/users/bob/plan.md", false)).toBe(true);
  });

  it("uses read-only docs workspace for guest markdown shares", () => {
    expect(shouldOpenDocsCollab("/users/bob/plan.md", true)).toBe(false);
  });

  it("keeps home route when no file is selected", () => {
    expect(shouldOpenDocsCollab(null, false)).toBe(false);
    expect(shouldOpenDocsCollab(null, true)).toBe(false);
  });
});
