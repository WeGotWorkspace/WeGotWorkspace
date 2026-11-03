import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DriveUploadItemView,
  DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";
import {
  clearDriveUploadBytesSent,
  driveUploadBytesSent,
  reportDriveUploadBytesSent,
  subscribeDriveUploadBytesSent,
  withDriveUploadBytesSent,
} from "@/lib/offline/drive/upload/drive-upload-live-bytes";

describe("live bytes sent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    clearDriveUploadBytesSent("item-1");
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("keeps the latest count, also when it is lower, and tells listeners at most once per interval", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDriveUploadBytesSent(listener);

    reportDriveUploadBytesSent("item-1", 100);
    reportDriveUploadBytesSent("item-1", 300);
    reportDriveUploadBytesSent("item-1", 200);
    expect(driveUploadBytesSent("item-1")).toBe(200);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("forgets an item once its request is over", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDriveUploadBytesSent(listener);
    reportDriveUploadBytesSent("item-1", 50);
    vi.advanceTimersByTime(250);
    listener.mockClear();

    clearDriveUploadBytesSent("item-1");
    vi.advanceTimersByTime(250);

    expect(driveUploadBytesSent("item-1")).toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("raises an uploading item to the bytes sent, capped at its size, and leaves others alone", () => {
    const item = (id: string, status: DriveUploadItemView["status"], bytesDone: number) =>
      ({ id, status, bytesDone, bytesTotal: 1_000 }) as DriveUploadItemView;
    const snapshot = {
      state: "uploading",
      items: [item("item-1", "uploading", 200), item("item-2", "queued", 0)],
      batches: [],
    } as unknown as DriveUploadQueueSnapshot;

    expect(withDriveUploadBytesSent(snapshot)).toBe(snapshot);

    reportDriveUploadBytesSent("item-1", 150);
    expect(withDriveUploadBytesSent(snapshot)).toBe(snapshot);

    reportDriveUploadBytesSent("item-1", 1_200);
    const merged = withDriveUploadBytesSent(snapshot);
    expect(merged.items.map((row) => row.bytesDone)).toEqual([1_000, 0]);
    expect(snapshot.items[0]!.bytesDone).toBe(200);
  });
});
