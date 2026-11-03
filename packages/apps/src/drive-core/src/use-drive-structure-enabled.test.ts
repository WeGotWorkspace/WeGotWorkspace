import { describe, expect, it } from "vitest";
import { isDriveStructureEditEnabled } from "@/drive-core/src/use-drive-mutations";

describe("isDriveStructureEditEnabled", () => {
  it("allows signed-in members", () => {
    expect(isDriveStructureEditEnabled("user", false)).toBe(true);
  });

  it("blocks a guest role", () => {
    expect(isDriveStructureEditEnabled("guest", false)).toBe(false);
  });

  it("blocks a guest session whose drive data still has a member-shaped user", () => {
    expect(isDriveStructureEditEnabled("user", true)).toBe(false);
  });
});
