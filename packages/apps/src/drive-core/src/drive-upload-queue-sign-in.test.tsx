/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDriveUploadQueueModel } from "@/drive-core/src/drive-upload-queue";
import {
  driveUploadStoryItemId,
  driveUploadStorySnapshot,
} from "@/drive-core/src/drive-upload-story-fixtures";

const signIn = vi.hoisted(() => ({ needed: true, start: vi.fn() }));
vi.mock("@/drive-core/src/drive-upload-sign-in", () => ({
  driveUploadNeedsSignIn: () => signIn.needed,
  signInThenRetryDriveUploads: signIn.start,
}));

function model() {
  const operations = {
    retryQueuedUpload: vi.fn(async () => true),
    retryAllFailedUploads: vi.fn(async () => 1),
    resumeUploadQueue: vi.fn(async () => 1),
  };
  const snapshot = driveUploadStorySnapshot({ cases: ["auth", "failed"], state: "idle" });
  const { result } = renderHook(() =>
    useDriveUploadQueueModel(snapshot, operations as never, vi.fn()),
  );
  return { model: result.current!, operations };
}

describe("Retry on an auth failure (#1522)", () => {
  beforeEach(() => {
    signIn.needed = true;
    signIn.start.mockReset();
  });

  it("sends the user through sign-in first when the session is gone", () => {
    const { model: queue, operations } = model();
    queue.retry?.(driveUploadStoryItemId("auth"));
    expect(signIn.start).toHaveBeenCalledWith("auth");
    expect(operations.retryQueuedUpload).not.toHaveBeenCalled();
  });

  it("retries other failures at once", () => {
    const { model: queue, operations } = model();
    queue.retry?.(driveUploadStoryItemId("failed"));
    expect(signIn.start).not.toHaveBeenCalled();
    expect(operations.retryQueuedUpload).toHaveBeenCalledWith(driveUploadStoryItemId("failed"));
  });

  it("retries an auth file at once while the session still stands", () => {
    signIn.needed = false;
    const { model: queue, operations } = model();
    queue.retry?.(driveUploadStoryItemId("auth"));
    expect(signIn.start).not.toHaveBeenCalled();
    expect(operations.retryQueuedUpload).toHaveBeenCalledOnce();
  });

  it("takes Retry all failed through sign-in when one of them is an auth file", () => {
    const { model: queue, operations } = model();
    queue.retryAllFailed?.();
    expect(signIn.start).toHaveBeenCalledWith("all");
    expect(operations.retryAllFailedUploads).not.toHaveBeenCalled();
  });

  it("resumes a queue paused on a full server", () => {
    const { model: queue, operations } = model();
    queue.resume?.();
    expect(operations.resumeUploadQueue).toHaveBeenCalledOnce();
  });
});
