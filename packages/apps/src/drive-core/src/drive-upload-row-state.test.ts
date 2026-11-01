import { describe, expect, it } from "vitest";
import { driveUploadPercent, driveUploadRowState } from "@/drive-core/src/drive-upload-row-state";
import type {
  DriveUploadBatchView,
  DriveUploadItemView,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

function item(overrides: Partial<DriveUploadItemView> = {}): DriveUploadItemView {
  return {
    id: "u1",
    batchId: "b1",
    name: "report.pdf",
    targetFolder: { kind: "server", id: "fn-1" },
    status: "queued",
    bytesDone: 0,
    bytesTotal: 1000,
    localCopy: true,
    createdAt: 1,
    canRetry: false,
    ...overrides,
  };
}

const released: DriveUploadBatchView = {
  id: "b1",
  status: "released",
  keepOffline: "remove",
  notices: [],
};

describe("driveUploadRowState", () => {
  it("falls back to the cached marker without a live queue", () => {
    expect(driveUploadRowState({ id: "u1", status: "queued" })).toMatchObject({
      kind: "waiting",
      statusText: "Waiting to upload",
      canRemove: true,
    });
    expect(driveUploadRowState({ id: "u1", status: "failed", reason: "too_large" })).toMatchObject({
      kind: "failed",
      canRetry: true,
      addAgain: false,
    });
  });

  it("says why a file waits: offline, or the batch dialog is still open", () => {
    const marker = { id: "u1", status: "queued" } as const;
    expect(
      driveUploadRowState(marker, { item: item(), batch: released, queueState: "paused_offline" })
        .statusText,
    ).toBe("Waiting for a connection");
    expect(
      driveUploadRowState(marker, {
        item: item(),
        batch: { ...released, status: "awaiting_input" },
        queueState: "paused_offline",
      }).statusText,
    ).toBe("Waiting for your answer");
  });

  it("stays indeterminate while bytes are unknown, and shows a percentage once reported", () => {
    const marker = { id: "u1", status: "uploading" } as const;
    const busy = driveUploadRowState(marker, { item: item({ status: "uploading" }) });
    expect(busy).toMatchObject({ kind: "uploading", percent: null, statusText: "Uploading" });
    expect(busy.canRemove).toBe(false);
    const part = driveUploadRowState(marker, {
      item: item({ status: "uploading", bytesDone: 420 }),
    });
    expect(part).toMatchObject({ percent: 42, statusText: "Uploading · 42%" });
  });

  it("shows the server assembling the file instead of 100%", () => {
    const state = driveUploadRowState(
      { id: "u1", status: "uploading" },
      { item: item({ status: "uploading", bytesDone: 1000, phase: "assembling" }) },
    );
    expect(state).toMatchObject({ kind: "assembling", percent: null });
    expect(state.statusText).toBe("Finishing on the server");
  });

  it("shows the assembling progress once the server reports it", () => {
    const state = driveUploadRowState(
      { id: "u1", status: "uploading" },
      {
        item: item({
          status: "uploading",
          bytesDone: 1000,
          phase: "assembling",
          assembledBytes: 400,
        }),
      },
    );
    expect(state).toMatchObject({ kind: "assembling", percent: 40 });
    expect(state.statusText).toBe("Finishing on the server · 40%");
  });

  it("says a large file needs https, and offers no Retry for it", () => {
    const state = driveUploadRowState(
      { id: "u1", status: "failed", reason: "insecure_context" },
      {
        item: item({
          status: "failed",
          canRetry: false,
          error: { code: "insecure_context", message: "https" },
        }),
      },
    );
    expect(state.statusText).toBe("Upload failed · Large files need a secure connection (https)");
    expect(state.canRetry).toBe(false);
  });

  it("offers only Remove when the bytes are gone", () => {
    const state = driveUploadRowState(
      { id: "u1", status: "failed", reason: "no_local_copy" },
      {
        item: item({
          status: "failed",
          localCopy: false,
          error: { code: "no_local_copy", message: "gone" },
        }),
      },
    );
    expect(state).toMatchObject({ addAgain: true, canRetry: false, canRemove: true });
    expect(state.statusText).toBe(
      "Upload failed · File no longer on this device · Add the file again",
    );
  });

  it("says a waiting file waits for space while the queue is paused on a full server", () => {
    const state = driveUploadRowState(
      { id: "u1", status: "queued" },
      { item: item(), batch: released, queueState: "paused_server_full" },
    );
    expect(state).toMatchObject({ kind: "waitingServerFull", canRemove: true });
    expect(state.statusText).toBe("Waiting for space on the server");
  });

  it("names the #1520 reasons in words", () => {
    const reasons = {
      auth: "Sign in again to upload",
      forbidden: "You can no longer add files to this folder",
      target_missing: "The folder no longer exists",
      transient: "The server kept failing",
      permanent: "Server did not accept it",
    } as const;
    for (const [code, words] of Object.entries(reasons)) {
      const state = driveUploadRowState(
        { id: "u1", status: "failed" },
        {
          item: item({
            status: "failed",
            canRetry: true,
            error: { code: code as keyof typeof reasons, message: "x" },
          }),
        },
      );
      expect(state).toMatchObject({ kind: "failed", reasonText: words, canRetry: true });
    }
  });

  it("warns that a direct upload will not survive going offline or a reload", () => {
    const state = driveUploadRowState(
      { id: "u1", status: "uploading" },
      { item: item({ status: "uploading", localCopy: false }) },
    );
    expect(state.notOnDevice).toBe(true);
    expect(state.statusText).toBe("Uploading · Not saved on this device");
    expect(state.valueText).toContain("won't survive going offline or a reload");
  });
});

describe("driveUploadPercent", () => {
  it("is null until the uploader reports bytes", () => {
    expect(driveUploadPercent({ bytesDone: 0, bytesTotal: 10 })).toBeNull();
    expect(driveUploadPercent({ bytesDone: 5, bytesTotal: 10 })).toBe(50);
    expect(driveUploadPercent({ bytesDone: 5, bytesTotal: 0 })).toBeNull();
  });
});
