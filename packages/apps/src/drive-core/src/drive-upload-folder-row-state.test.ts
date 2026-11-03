import { describe, expect, it } from "vitest";
import { driveUploadFolderRowState } from "@/drive-core/src/drive-upload-folder-row-state";
import type { DriveUploadFolderView } from "@/lib/offline/drive/upload/drive-upload-subscription";

function folder(progress: Partial<DriveUploadFolderView> = {}): DriveUploadFolderView {
  return {
    id: "f1",
    batchId: "b1",
    name: "Photos",
    sourceName: "Photos",
    status: "created",
    targetFolder: { kind: "server", id: "root" },
    subtreeBytes: 1000,
    subtreeFiles: 10,
    bytesDone: 0,
    filesDone: 0,
    failedFiles: 0,
    canRetry: false,
    ...progress,
  };
}

describe("driveUploadFolderRowState (#1620)", () => {
  it("waits like a file until something below it moves", () => {
    expect(driveUploadFolderRowState(folder({ status: "waiting" })).statusText).toBe(
      "Waiting to upload",
    );
    expect(
      driveUploadFolderRowState(folder({ status: "waiting" }), { queueState: "paused_offline" })
        .kind,
    ).toBe("waitingOffline");
    expect(
      driveUploadFolderRowState(folder({ status: "waiting" }), {
        batch: { id: "b1", status: "awaiting_input", keepOffline: "remove", notices: [] },
      }).kind,
    ).toBe("waitingForAnswer");
  });

  it("shows uploading once it exists, while the queue runs", () => {
    expect(driveUploadFolderRowState(folder()).statusText).toBe("Uploading · 0%");
    expect(driveUploadFolderRowState(folder(), { queueState: "paused_offline" }).kind).toBe(
      "waitingOffline",
    );
  });

  it("shows the progress of everything below it, with the files that failed", () => {
    const state = driveUploadFolderRowState(
      folder({ bytesDone: 420, filesDone: 3, failedFiles: 2 }),
    );
    expect(state).toMatchObject({
      kind: "uploading",
      percent: 42,
      statusText: "Uploading · 42% · 2 files failed",
      canRemove: false,
    });
  });

  it("turns failed once nothing below it is still going", () => {
    const state = driveUploadFolderRowState(
      folder({ bytesDone: 800, filesDone: 8, failedFiles: 2, canRetry: true }),
    );
    expect(state).toMatchObject({
      kind: "failed",
      statusText: "Upload failed · 2 files failed",
      canRetry: true,
      canRemove: true,
    });
  });

  it("says why the folder itself could not be made", () => {
    const state = driveUploadFolderRowState(
      folder({
        status: "failed",
        canRetry: true,
        error: { code: "forbidden", message: "" },
      }),
    );
    expect(state).toMatchObject({
      kind: "failed",
      reason: "forbidden",
      statusText: "Upload failed · You can no longer add files to this folder",
      canRetry: true,
    });
  });
});
