/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDriveUploadQueueModel } from "@/drive-core/src/drive-upload-queue";
import { signInThenRetryDriveUploads } from "@/drive-core/src/drive-upload-sign-in";
import {
  driveUploadStoryItemId,
  driveUploadStorySnapshot,
} from "@/drive-core/src/drive-upload-story-fixtures";
import {
  useDriveUploadLeaveWarning,
  useDriveUploadRetryAfterSignIn,
} from "@/drive-core/src/use-drive-upload-recovery";

const lastTab = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/offline/drive/upload/drive-upload-last-tab", () => ({
  isLastDriveUploaderTab: async () => lastTab.value,
}));

function beforeUnload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

describe("useDriveUploadLeaveWarning (#1522)", () => {
  beforeEach(() => {
    lastTab.value = true;
  });

  it("warns while files upload in the last tab", async () => {
    renderHook(() => useDriveUploadLeaveWarning("running", "alice"));
    await waitFor(() => expect(beforeUnload().defaultPrevented).toBe(true));
  });

  it("does not warn when another tab would take over", async () => {
    lastTab.value = false;
    renderHook(() => useDriveUploadLeaveWarning("running", "alice"));
    await waitFor(() => expect(beforeUnload().defaultPrevented).toBe(false));
  });

  it("does not warn while the queue waits (offline, server full, idle)", () => {
    for (const state of ["paused_offline", "paused_server_full", "idle"] as const) {
      const { unmount } = renderHook(() => useDriveUploadLeaveWarning(state, "alice"));
      expect(beforeUnload().defaultPrevented).toBe(false);
      unmount();
    }
  });

  it("stops warning once the queue is done", async () => {
    const { rerender } = renderHook(({ state }) => useDriveUploadLeaveWarning(state, "alice"), {
      initialProps: { state: "running" as "running" | "idle" },
    });
    await waitFor(() => expect(beforeUnload().defaultPrevented).toBe(true));
    rerender({ state: "idle" });
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
});

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
