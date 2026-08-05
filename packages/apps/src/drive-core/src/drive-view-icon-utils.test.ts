import { describe, expect, it } from "vitest";
import { Clock, HardDrive, Star, Trash2, Users2 } from "lucide-react";
import { driveViewIcons, resolveDriveViewIcon } from "@/drive-core/src/drive-view-icon-utils";

describe("resolveDriveViewIcon", () => {
  it("maps virtual views to sidebar icons", () => {
    expect(resolveDriveViewIcon({ type: "recent" })).toBe(driveViewIcons.recent);
    expect(resolveDriveViewIcon({ type: "starred" })).toBe(driveViewIcons.starred);
    expect(resolveDriveViewIcon({ type: "shared" })).toBe(driveViewIcons.sharedWithMe);
  });

  it("uses trash icon for trash folders", () => {
    expect(resolveDriveViewIcon({ type: "folder", path: "Trash" })).toBe(Trash2);
    expect(resolveDriveViewIcon({ type: "folder", path: "Trash/Old" })).toBe(Trash2);
  });

  it("uses group drive icon for group paths", () => {
    expect(resolveDriveViewIcon({ type: "folder", path: "Groups/Engineering" })).toBe(HardDrive);
  });

  it("defaults to my drive icon for regular folders", () => {
    expect(resolveDriveViewIcon({ type: "folder", path: "My Drive/Assets" })).toBe(HardDrive);
  });

  it("exposes stable icon references for sidebar model", () => {
    expect(driveViewIcons.recent).toBe(Clock);
    expect(driveViewIcons.starred).toBe(Star);
    expect(driveViewIcons.sharedWithMe).toBe(Users2);
    expect(driveViewIcons.trash).toBe(Trash2);
  });
});
