import { describe, expect, it } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import type { DriveUIData } from "@/drive-core/src/drive-types";
import { mergeDriveUploadPlaceholders } from "@/drive-core/src/drive-upload-listing";

const user = "ada";

function entry(name: string, upload?: WgwDriveDirectoryEntry["upload"]): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path: upload ? `/users/ada/\u0000upload:${upload.id}` : `/users/ada/${name}`,
    name,
    size: 3,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
    ...(upload ? { upload } : {}),
  };
}

function cached(files: WgwDriveDirectoryEntry[]): DriveUIData {
  return {
    user: { username: user, name: user, role: "user", roots: [] },
    cwd: "/users/ada",
    directory: { location: "/users/ada", files },
  };
}

describe("mergeDriveUploadPlaceholders", () => {
  it("shows new placeholders with their status and keeps real rows", () => {
    const real = driveFileFromEntry(entry("old.txt"), user);
    const merged = mergeDriveUploadPlaceholders(
      [real],
      cached([entry("old.txt"), entry("new.pdf", { id: "u1", batchId: "b", status: "uploading" })]),
      "My Drive",
      user,
    );
    expect(merged.map((file) => [file.title, file.upload?.status])).toEqual([
      ["old.txt", undefined],
      ["new.pdf", "uploading"],
    ]);
    expect(merged[1]?.notebook).toContain("Uploading");
  });

  it("swaps a finished placeholder for the uploaded file", () => {
    const placeholder = driveFileFromEntry(
      entry("new.pdf", { id: "u1", batchId: "b", status: "uploading" }),
      user,
    );
    const merged = mergeDriveUploadPlaceholders(
      [placeholder],
      cached([entry("new.pdf")]),
      "My Drive",
      user,
    );
    expect(merged.map((file) => [file.id, file.upload])).toEqual([
      ["/users/ada/new.pdf", undefined],
    ]);
  });

  it("adds only placeholders to a listing that was just loaded", () => {
    const real = driveFileFromEntry(entry("old.txt"), user);
    const merged = mergeDriveUploadPlaceholders(
      [real],
      cached([entry("stale.txt"), entry("new.pdf", { id: "u1", batchId: "b", status: "queued" })]),
      "My Drive",
      user,
      { placeholdersOnly: true },
    );
    expect(merged.map((file) => file.title)).toEqual(["old.txt", "new.pdf"]);
  });

  it("drops placeholders when the folder has nothing cached any more", () => {
    const placeholder = driveFileFromEntry(
      entry("gone.pdf", { id: "u1", batchId: "b", status: "queued" }),
      user,
    );
    expect(mergeDriveUploadPlaceholders([placeholder], null, "My Drive", user)).toEqual([]);
  });
});
