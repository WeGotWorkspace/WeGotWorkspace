/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDriveUploadLeaveWarning } from "@/lib/offline/drive/upload/drive-upload-leave-warning";
import {
  keepUploadInMemory,
  forgetUploadInMemory,
} from "@/lib/offline/drive/upload/drive-upload-memory";
import type {
  DriveUploadItemView,
  DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";

const mocks = vi.hoisted(() => ({
  last: true,
  snapshot: null as unknown,
  listener: null as null | ((snapshot: unknown) => void),
}));

vi.mock("@/lib/offline/drive/upload/drive-upload-last-tab", () => ({
  isLastDriveUploaderTab: async () => mocks.last,
}));
vi.mock("@/lib/offline/drive/upload/drive-upload-subscription", () => ({
  subscribeDriveUploadQueue: (_username: string, listener: (snapshot: unknown) => void) => {
    mocks.listener = listener;
    listener(mocks.snapshot);
    return () => undefined;
  },
}));

function item(over: Partial<DriveUploadItemView>): DriveUploadItemView {
  return {
    id: "i1",
    batchId: "b1",
    name: "a.bin",
    targetFolder: { id: "root", name: "My Drive" },
    status: "queued",
    bytesDone: 0,
    bytesTotal: 1,
    localCopy: true,
    createdAt: 1,
    canRetry: true,
    ...over,
  } as DriveUploadItemView;
}

function snapshot(
  state: DriveUploadQueueSnapshot["state"],
  items: DriveUploadItemView[] = [item({})],
): DriveUploadQueueSnapshot {
  return { state, items, folders: [], batches: [], hasItems: items.length > 0, totalBytes: 1 };
}

function beforeUnload(): BeforeUnloadEvent {
  const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startDriveUploadLeaveWarning (#1522)", () => {
  let stop: () => void;
  beforeEach(() => {
    mocks.last = true;
  });
  afterEach(() => {
    stop?.();
    forgetUploadInMemory("i1");
  });

  it("warns while files upload in the last tab, with no Drive view mounted", async () => {
    mocks.snapshot = snapshot("running");
    stop = startDriveUploadLeaveWarning("alice");
    await tick();
    expect(beforeUnload().defaultPrevented).toBe(true);
  });

  it("does not warn when another tab would take over a device-stored file", async () => {
    mocks.last = false;
    mocks.snapshot = snapshot("running");
    stop = startDriveUploadLeaveWarning("alice");
    await tick();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("warns for a file held only in this tab's memory, even with another tab open", async () => {
    mocks.last = false;
    keepUploadInMemory("i1", new File(["x"], "a.bin"));
    mocks.snapshot = snapshot("running", [item({ localCopy: false })]);
    stop = startDriveUploadLeaveWarning("alice");
    await tick();
    expect(beforeUnload().defaultPrevented).toBe(true);
  });

  it("does not warn for a failed in-memory file", async () => {
    keepUploadInMemory("i1", new File(["x"], "a.bin"));
    mocks.snapshot = snapshot("idle", [item({ localCopy: false, status: "failed" })]);
    stop = startDriveUploadLeaveWarning("alice");
    await tick();
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("does not warn while the queue waits or is idle", async () => {
    for (const state of ["paused_offline", "paused_server_full", "idle"] as const) {
      mocks.snapshot = snapshot(state);
      stop = startDriveUploadLeaveWarning("alice");
      await tick();
      expect(beforeUnload().defaultPrevented).toBe(false);
      stop();
    }
  });

  it("stops warning once the queue is done", async () => {
    mocks.snapshot = snapshot("running");
    stop = startDriveUploadLeaveWarning("alice");
    await tick();
    mocks.listener?.(snapshot("idle"));
    expect(beforeUnload().defaultPrevented).toBe(false);
  });
});
