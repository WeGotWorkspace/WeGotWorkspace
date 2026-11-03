/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDriveUploadQueueModel } from "@/drive-core/src/drive-upload-queue";
import { signInThenRetryDriveUploads } from "@/drive-core/src/drive-upload-sign-in";
import {
  driveUploadStoryItemId,
  driveUploadStorySnapshot,
} from "@/drive-core/src/drive-upload-story-fixtures";
import { useDriveUploadRetryAfterSignIn } from "@/drive-core/src/use-drive-upload-recovery";

describe("useDriveUploadRetryAfterSignIn (#1522)", () => {
  afterEach(() => window.sessionStorage.clear());

  const snapshot = driveUploadStorySnapshot({ cases: ["auth", "failed"], state: "idle" });
  const model = buildDriveUploadQueueModel(snapshot);

  it("sends the auth files back to the queue after the sign-in Retry started", async () => {
    signInThenRetryDriveUploads("auth", () => undefined);
    const operations = {
      retryQueuedUpload: vi.fn(async () => true),
      retryAllFailedUploads: vi.fn(),
    };
    renderHook(() => useDriveUploadRetryAfterSignIn(model, operations, vi.fn()));
    await waitFor(() =>
      expect(operations.retryQueuedUpload).toHaveBeenCalledWith(driveUploadStoryItemId("auth")),
    );
    expect(operations.retryQueuedUpload).toHaveBeenCalledTimes(1);
    expect(operations.retryAllFailedUploads).not.toHaveBeenCalled();
  });

  it("retries every failed file after Retry all failed", async () => {
    signInThenRetryDriveUploads("all", () => undefined);
    const operations = { retryQueuedUpload: vi.fn(), retryAllFailedUploads: vi.fn(async () => 2) };
    renderHook(() => useDriveUploadRetryAfterSignIn(model, operations, vi.fn()));
    await waitFor(() => expect(operations.retryAllFailedUploads).toHaveBeenCalledOnce());
  });

  it("does nothing on a Drive load that no sign-in Retry started", () => {
    const operations = { retryQueuedUpload: vi.fn(), retryAllFailedUploads: vi.fn() };
    renderHook(() => useDriveUploadRetryAfterSignIn(model, operations, vi.fn()));
    expect(operations.retryQueuedUpload).not.toHaveBeenCalled();
    expect(operations.retryAllFailedUploads).not.toHaveBeenCalled();
  });
});
