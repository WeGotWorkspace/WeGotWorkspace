import { describe, expect, it } from "vitest";
import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import {
  canPickDriveFolderDestination,
  isDriveFolderPickerDestinationPath,
  resolveDriveFolderPickerStartPath,
} from "@/drive-core/src/drive-folder-picker-utils";
import type { DriveFile } from "@/drive-core/src/drive-models";

describe("resolveDriveFolderPickerStartPath", () => {
  it("opens at the current folder when not in trash", () => {
    expect(resolveDriveFolderPickerStartPath({ type: "folder", path: "My Drive/Assets" })).toBe(
      "My Drive/Assets",
    );
  });

  it("falls back to single item parent outside trash", () => {
    expect(resolveDriveFolderPickerStartPath({ type: "recent" }, "My Drive/Projects")).toBe(
      "My Drive/Projects",
    );
  });

  it("defaults to My Drive for trash and virtual views without parent", () => {
    expect(resolveDriveFolderPickerStartPath({ type: "folder", path: "Trash" })).toBe("My Drive");
    expect(resolveDriveFolderPickerStartPath({ type: "starred" })).toBe("My Drive");
    expect(resolveDriveFolderPickerStartPath({ type: "recent" }, "Trash/Old")).toBe("My Drive");
  });
});

describe("isDriveFolderPickerDestinationPath", () => {
  it("rejects virtual roots and accepts concrete drives/folders", () => {
    expect(isDriveFolderPickerDestinationPath(DRIVE_FOLDER_PICKER_ROOT)).toBe(false);
    expect(isDriveFolderPickerDestinationPath("Groups")).toBe(false);
    expect(isDriveFolderPickerDestinationPath("Trash")).toBe(false);
    expect(isDriveFolderPickerDestinationPath("My Drive")).toBe(true);
    expect(isDriveFolderPickerDestinationPath("Groups/engineering")).toBe(true);
    expect(isDriveFolderPickerDestinationPath("My Drive/Projects")).toBe(true);
  });
});

describe("canPickDriveFolderDestination", () => {
  const file: DriveFile = {
    id: "1",
    notebook: "",
    category: "File",
    date: "Now",
    title: "notes.md",
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "1 B",
  };

  it("allows any concrete path when moveIds is empty (create flow)", () => {
    expect(canPickDriveFolderDestination([file], [], "My Drive")).toBe(true);
    expect(canPickDriveFolderDestination([file], [], "Groups/engineering")).toBe(true);
    expect(canPickDriveFolderDestination([file], [], DRIVE_FOLDER_PICKER_ROOT)).toBe(false);
  });

  it("still blocks current parent during move", () => {
    expect(canPickDriveFolderDestination([file], ["1"], "My Drive")).toBe(false);
    expect(canPickDriveFolderDestination([file], ["1"], "Groups/engineering")).toBe(true);
  });
});
