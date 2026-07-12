import { describe, expect, it } from "vitest";
import { mockDriveShareAtPath } from "@/lib/api/mock/drive-share-fixtures";
import { driveItemHasShareGrants } from "@/drive-core/src/drive-share-status";

describe("driveItemHasShareGrants", () => {
  it("returns true when fixture path has direct grants", () => {
    expect(driveItemHasShareGrants(mockDriveShareAtPath)).toBe(true);
  });

  it("returns false when share data is empty", () => {
    expect(
      driveItemHasShareGrants({
        ...mockDriveShareAtPath,
        directShares: [],
        grantSources: [],
        publicShares: [],
      }),
    ).toBe(false);
  });

  it("returns false for nullish input", () => {
    expect(driveItemHasShareGrants(null)).toBe(false);
    expect(driveItemHasShareGrants(undefined)).toBe(false);
  });
});
