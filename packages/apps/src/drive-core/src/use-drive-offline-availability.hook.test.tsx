import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";

const mocks = vi.hoisted(() => ({
  metadataRunning: false,
  contentRunning: false,
  stored: new Set<string>(),
}));

vi.mock("@/hooks/use-connectivity", () => ({ useConnectivity: () => ({ online: true }) }));
vi.mock("@/lib/offline/core/offline-device-settings", () => ({
  isEligibleForAutoContentSync: () => true,
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
vi.mock("@/lib/offline/drive/drive-content-sync", () => ({
  readDriveContentSyncProgress: async () => ({ running: mocks.contentRunning }),
}));
vi.mock("@/lib/offline/drive/drive-metadata-sync", () => ({
  readDriveMetadataSyncProgress: async () => ({ running: mocks.metadataRunning }),
}));
vi.mock("@/lib/offline/shared/content-availability", () => ({
  hasOfflineFileContent: async (_user: string, path: string) => mocks.stored.has(path),
}));
vi.mock("@/lib/offline/drive/drive-availability-store", () => ({
  normalizeDriveAvailabilityPath: (path: string) => path,
}));

import { useDriveOfflineAvailability } from "@/drive-core/src/use-drive-offline-availability";

const files = [
  { id: "a", kind: "file", name: "a.md", apiPath: "/a.md", size: "1 KB" },
] as unknown as DriveFile[];

describe("useDriveOfflineAvailability while syncing", () => {
  beforeEach(() => {
    mocks.metadataRunning = false;
    mocks.contentRunning = false;
    mocks.stored = new Set();
  });

  it("ignores a running metadata sync", async () => {
    mocks.metadataRunning = true;
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.offlinePendingSyncIds.has("a")).toBe(false);
  });

  it("marks the row while content syncs and clears it once stored, without a list change", async () => {
    mocks.contentRunning = true;
    const { result } = renderHook(() => useDriveOfflineAvailability(files, true, "u"));
    await waitFor(() => expect(result.current.offlinePendingSyncIds.has("a")).toBe(true));

    mocks.stored.add("/a.md");
    await waitFor(() => expect(result.current.offlineAvailableIds.has("a")).toBe(true), {
      timeout: 4000,
    });
    expect(result.current.offlinePendingSyncIds.has("a")).toBe(false);
  });
});
