import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/lib/files/drive-models";

const mocks = vi.hoisted(() => ({
  online: true,
  stored: new Set<string>(),
  failures: {} as Record<string, { attempts: number; modifiedAt: number }>,
}));

vi.mock("@/hooks/use-connectivity", () => ({ useConnectivity: () => ({ online: mocks.online }) }));
vi.mock("@/lib/offline/core/offline-device-settings", () => ({
  readOfflineDeviceContentSettings: () => ({
    contentSyncEnabled: true,
    maxFileSizeBytes: 10 * 1024 * 1024,
  }),
  subscribeOfflineDeviceContentSettings: () => () => {},
}));
vi.mock("@/lib/offline/core/outbox-store", () => ({
  listOutboxMutationsForDomain: async () => [],
}));
vi.mock("@/lib/offline/drive/drive-outbox-flush", () => ({ driveOutboxApiPath: () => null }));
vi.mock("@/lib/offline/drive/drive-schema", () => ({ DRIVE_DOMAIN: "drive" }));
vi.mock("@/lib/offline/core/meta-store", () => ({
  readMeta: async () => JSON.stringify(mocks.failures),
  writeMeta: async (_user: string, _key: string, value: string) => {
    mocks.failures = JSON.parse(value) as typeof mocks.failures;
  },
}));
vi.mock("@/lib/offline/shared/content-availability", () => ({
  hasOfflineFileContent: async (_user: string, path: string) => mocks.stored.has(path),
}));
vi.mock("@/lib/offline/drive/drive-availability-store", () => ({
  normalizeDriveAvailabilityPath: (path: string) => path,
}));

import { useDriveOfflineAvailability } from "@/drive-core/src/use-drive-offline-availability";
import {
  beginDriveContentRun,
  endDriveContentRun,
  finishDriveContentRunItem,
  recordDriveContentFailure,
  resetDriveContentRunStateForTests,
} from "@/lib/offline/drive/drive-content-run-state";

const files = [
  { id: "a", kind: "file", name: "a.md", apiPath: "/a.md", size: "1 KB", modifiedMs: 5000 },
  { id: "b", kind: "file", name: "b.md", apiPath: "/b.md", size: "1 KB", modifiedMs: 5000 },
] as unknown as DriveFile[];

describe("useDriveOfflineAvailability", () => {
  beforeEach(() => {
    mocks.online = true;
    mocks.stored = new Set();
    mocks.failures = {};
    resetDriveContentRunStateForTests();
  });

  it("spins only for the files in the current run's queue", async () => {
    beginDriveContentRun("u", ["/a.md"]);
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.offlinePendingSyncIds.has("a")).toBe(true));
    expect(result.current.offlinePendingSyncIds.has("b")).toBe(false);
  });

  it("clears the spinner once the file is stored, without a list change", async () => {
    const run = beginDriveContentRun("u", ["/a.md"]);
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.offlinePendingSyncIds.has("a")).toBe(true));

    mocks.stored.add("/a.md");
    act(() => finishDriveContentRunItem(run, "/a.md"));
    await waitFor(() => expect(result.current.offlineAvailableIds.has("a")).toBe(true));
    expect(result.current.offlinePendingSyncIds.has("a")).toBe(false);
  });

  it("stops every spinner when the run ends or is aborted", async () => {
    const run = beginDriveContentRun("u", ["/a.md", "/b.md"]);
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.offlinePendingSyncIds.size).toBe(2));
    act(() => endDriveContentRun(run));
    await waitFor(() => expect(result.current.offlinePendingSyncIds.size).toBe(0));
  });

  it("does not spin while offline, even with files still queued", async () => {
    mocks.online = false;
    beginDriveContentRun("u", ["/a.md"]);
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.offlinePendingSyncIds.size).toBe(0);
  });

  it("shows a failed download as failed, not as spinning", async () => {
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    await act(async () => {
      await recordDriveContentFailure("u", "/a.md", 5);
      beginDriveContentRun("u", ["/a.md"]);
    });
    await waitFor(() => expect(result.current.offlineFailedIds.has("a")).toBe(true));
    expect(result.current.offlinePendingSyncIds.has("a")).toBe(false);
  });

  it("ignores a failure recorded for an older version of the file", async () => {
    mocks.failures = { "a.md": { attempts: 3, modifiedAt: 1 } };
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.offlineFailedIds.has("a")).toBe(false);
  });
});
