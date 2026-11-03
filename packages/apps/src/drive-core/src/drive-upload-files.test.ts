import { describe, expect, it } from "vitest";
import { driveFilesFromUploadQueue } from "@/drive-core/src/drive-upload-files";
import type { DriveUploadItemView } from "@/lib/offline/drive/upload/drive-upload-subscription";

const base: DriveUploadItemView = {
  id: "u1",
  batchId: "b1",
  name: "photo.jpg",
  targetFolder: { kind: "server", id: "fn-1" },
  status: "failed",
  bytesDone: 0,
  bytesTotal: 2048,
  localCopy: true,
  createdAt: 1,
  canRetry: true,
  folderPath: "users/ada/Trips/2026",
  error: { code: "too_large", message: "big" },
};

describe("driveFilesFromUploadQueue", () => {
  it("gives each queued file its target folder path and readable name", () => {
    const [file] = driveFilesFromUploadQueue({ items: [base] }, "ada");
    expect(file).toMatchObject({
      id: "upload:u1",
      title: "photo.jpg",
      kind: "image",
      parent: "My Drive/Trips/2026",
      location: "Personal / Trips / 2026",
      upload: { id: "u1", status: "failed", reason: "too_large" },
    });
    expect(file?.apiPath).toBeUndefined();
  });

  it("names group drives by their label and leaves an unknown folder empty", () => {
    const files = driveFilesFromUploadQueue(
      {
        items: [
          { ...base, id: "u2", folderPath: "groups/eng/Specs" },
          { ...base, id: "u3", folderPath: undefined },
        ],
      },
      "ada",
      { "Groups/eng": "Engineering" },
    );
    expect(files.map((file) => file.location)).toEqual(["Engineering / Specs", undefined]);
  });
});
