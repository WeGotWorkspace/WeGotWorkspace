import { describe, expect, it } from "vitest";
import { driveRowOfflineState } from "@/drive-core/src/use-drive-offline-availability";

const settings = { contentSyncEnabled: true, maxFileSizeBytes: 10 * 1024 * 1024 };
const base = {
  hasLocal: false,
  isFolder: false,
  sizeBytes: 1024,
  syncRunning: true,
  online: true,
  settings,
};

describe("driveRowOfflineState while a background sync runs", () => {
  it("marks a small file that is not on the device yet as syncing", () => {
    expect(driveRowOfflineState(base)).toBe("syncing");
  });

  it("shows a file already on the device as available, not syncing", () => {
    expect(driveRowOfflineState({ ...base, hasLocal: true })).toBe("available");
  });

  it("offers a file above the size limit instead of a spinner", () => {
    expect(driveRowOfflineState({ ...base, sizeBytes: 20 * 1024 * 1024 })).toBe("too-large");
  });

  it("does not mark folders", () => {
    expect(driveRowOfflineState({ ...base, isFolder: true, sizeBytes: null })).toBe("none");
  });

  it("does not mark anything when automatic copies are off", () => {
    expect(
      driveRowOfflineState({ ...base, settings: { ...settings, contentSyncEnabled: false } }),
    ).toBe("none");
  });
});

describe("driveRowOfflineState with no sync running", () => {
  it("leaves a small file that is not on the device unmarked", () => {
    expect(driveRowOfflineState({ ...base, syncRunning: false })).toBe("none");
  });

  it("still offers a large file while online", () => {
    expect(driveRowOfflineState({ ...base, syncRunning: false, sizeBytes: 20 * 1024 * 1024 })).toBe(
      "too-large",
    );
  });

  it("does not offer a large file while offline", () => {
    expect(
      driveRowOfflineState({
        ...base,
        syncRunning: false,
        online: false,
        sizeBytes: 20 * 1024 * 1024,
      }),
    ).toBe("none");
  });
});
