import { describe, expect, it } from "vitest";
import { driveLabels, driveUploadStatusText } from "@/drive-core/src/drive-labels";

describe("driveLabels", () => {
  it("reserves document wording for the Docs editor", () => {
    expect(driveLabels.newMarkdown).toBe("New document");
    expect(driveLabels.createMarkdownDialogTitle).toBe("New document");
  });

  it("labels Shared with me and My Drives from the shared files-browser SST", () => {
    expect(driveLabels.sidebarHome).toBe("My Files");
    expect(driveLabels.sidebarMyDrive).toBe("Personal");
    expect(driveLabels.sidebarSharedWithMe).toBe("Shared with me");
    expect(driveLabels.sidebarSharedDrives).toBe("My Drives");
    expect(driveLabels.sharedBy("hana")).toBe("Shared by hana");
  });
});

describe("driveUploadStatusText", () => {
  it("names the status, and the reason once an upload failed", () => {
    expect(driveUploadStatusText({ id: "u", status: "queued" })).toBe("Waiting to upload");
    expect(driveUploadStatusText({ id: "u", status: "uploading" })).toBe("Uploading");
    expect(driveUploadStatusText({ id: "u", status: "failed" })).toBe("Upload failed");
    expect(driveUploadStatusText({ id: "u", status: "failed", reason: "too_large" })).toBe(
      "Upload failed · Too large to upload",
    );
  });
});
