import { describe, expect, it } from "vitest";
import { driveUploadAnnouncements } from "@/drive-core/src/drive-upload-announcer";
import type { DriveUploadItemView } from "@/lib/offline/drive/upload/drive-upload-subscription";

function view(id: string, overrides: Partial<DriveUploadItemView> = {}): DriveUploadItemView {
  return {
    id,
    batchId: "b",
    name: `${id}.pdf`,
    targetFolder: { kind: "server", id: "f" },
    status: "queued",
    bytesDone: 0,
    bytesTotal: 100,
    localCopy: true,
    createdAt: 1,
    canRetry: false,
    ...overrides,
  };
}

describe("driveUploadAnnouncements", () => {
  it("announces start, done, and failure, but not a removal", () => {
    const previous = new Map([
      ["a", view("a", { status: "uploading" })],
      ["b", view("b")],
      ["c", view("c")],
      ["d", view("d")],
    ]);
    const next = [
      view("c", { status: "uploading" }),
      view("d", { status: "failed", error: { code: "too_large", message: "x" } }),
    ];
    expect(driveUploadAnnouncements(previous, next)).toEqual([
      "a.pdf uploaded",
      "Uploading c.pdf",
      "d.pdf could not be uploaded: Too large to upload",
    ]);
  });

  it("announces a determinate upload per quarter, not per byte", () => {
    const previous = new Map([["a", view("a", { status: "uploading", bytesDone: 20 })]]);
    expect(
      driveUploadAnnouncements(previous, [view("a", { status: "uploading", bytesDone: 24 })]),
    ).toEqual([]);
    expect(
      driveUploadAnnouncements(previous, [view("a", { status: "uploading", bytesDone: 51 })]),
    ).toEqual(["Uploading a.pdf, 50%"]);
  });
});
