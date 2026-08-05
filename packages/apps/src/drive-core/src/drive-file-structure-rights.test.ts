import { describe, expect, it } from "vitest";
import { resolveDriveFileCanManageStructure } from "@/drive-core/src/drive-file-structure-rights";

describe("resolveDriveFileCanManageStructure", () => {
  it("allows when rights are unknown (Storybook / missing myRights)", () => {
    expect(resolveDriveFileCanManageStructure(undefined)).toBe(true);
  });

  it("allows full access", () => {
    expect(resolveDriveFileCanManageStructure(true)).toBe(true);
  });

  it("denies without full access", () => {
    expect(resolveDriveFileCanManageStructure(false)).toBe(false);
  });

  it("prefers active resolved rights when row is active", () => {
    expect(
      resolveDriveFileCanManageStructure(true, {
        isActive: true,
        activeMayManageStructure: false,
      }),
    ).toBe(false);
    expect(
      resolveDriveFileCanManageStructure(false, {
        isActive: true,
        activeMayManageStructure: true,
      }),
    ).toBe(true);
  });
});
