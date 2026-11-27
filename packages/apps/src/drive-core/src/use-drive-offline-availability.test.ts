import { describe, expect, it } from "vitest";
import { driveRowOfflineState } from "@/drive-core/src/use-drive-offline-availability";

const settings = { contentSyncEnabled: true, maxFileSizeBytes: 10 * 1024 * 1024 };
const base = {
  hasLocal: false,
  isFolder: false,
  sizeBytes: 1024,
  queued: true,
  failed: false,
  online: true,
  settings,
};

describe("driveRowOfflineState for a file the current run will download", () => {
  it("spins while the file is in the run's queue", () => {
    expect(driveRowOfflineState(base)).toBe("syncing");
  });

  it("shows a file already on the device as available, not syncing", () => {
    expect(driveRowOfflineState({ ...base, hasLocal: true })).toBe("available");
  });

  it("never spins while the device is offline", () => {
    expect(driveRowOfflineState({ ...base, online: false })).toBe("none");
  });

  it("does not mark folders", () => {
    expect(driveRowOfflineState({ ...base, isFolder: true, sizeBytes: null })).toBe("none");
  });
});

describe("driveRowOfflineState for a file the run will not download", () => {
  it("does not spin for a file outside the queue", () => {
    expect(driveRowOfflineState({ ...base, queued: false })).toBe("none");
  });

  it("offers a large file while online", () => {
    expect(driveRowOfflineState({ ...base, queued: false, sizeBytes: 20 * 1024 * 1024 })).toBe(
      "too-large",
    );
  });

  it("does not offer a large file while offline", () => {
    expect(
      driveRowOfflineState({
        ...base,
        queued: false,
        online: false,
        sizeBytes: 20 * 1024 * 1024,
      }),
    ).toBe("none");
  });

  it("does not mark anything when automatic copies are off", () => {
    expect(
      driveRowOfflineState({
        ...base,
        queued: false,
        settings: { ...settings, contentSyncEnabled: false },
      }),
    ).toBe("none");
  });
});

describe("driveRowOfflineState after a failed download", () => {
  it("shows failed, not a spinner, also while a later run retries it", () => {
    expect(driveRowOfflineState({ ...base, failed: true })).toBe("failed");
  });

  it("keeps showing failed offline", () => {
    expect(driveRowOfflineState({ ...base, failed: true, online: false })).toBe("failed");
  });

  it("shows available once a copy is stored", () => {
    expect(driveRowOfflineState({ ...base, failed: true, hasLocal: true })).toBe("available");
  });
});
