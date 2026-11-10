import { describe, expect, it } from "vitest";
import {
  DRIVE_FOLDER_PICKER_ROOT,
  buildDriveFolderPickerBreadcrumbs,
  buildDriveViewBreadcrumbs,
} from "@/drive-core/src/drive-breadcrumbs";
import { driveLabels } from "@/drive-core/src/drive-labels";

describe("Team drive root crumb", () => {
  it("labels the Groups root Teams in the folder view", () => {
    expect(buildDriveViewBreadcrumbs({ type: "folder", path: "Groups" }, driveLabels)).toEqual([
      { label: "Teams", path: null },
    ]);
  });

  it("labels the Groups root Teams in the folder picker and keeps the path key", () => {
    expect(buildDriveFolderPickerBreadcrumbs("Groups", driveLabels)).toEqual([
      { label: driveLabels.folderPickerDrivesRoot, path: DRIVE_FOLDER_PICKER_ROOT },
      { label: "Teams", path: "Groups" },
    ]);
  });

  it("names a team drive in the folder picker by its root label", () => {
    expect(
      buildDriveFolderPickerBreadcrumbs("Groups/design/specs", driveLabels, {
        "Groups/design": "Design",
      }),
    ).toEqual([
      { label: driveLabels.folderPickerDrivesRoot, path: DRIVE_FOLDER_PICKER_ROOT },
      { label: "Design", path: "Groups/design" },
      { label: "specs", path: "Groups/design/specs" },
    ]);
  });
});

describe("driveLabels.accessViaTeam", () => {
  it("says Team for access that comes from a team grant", () => {
    expect(driveLabels.accessViaTeam("design")).toBe("Team: design");
  });
});
