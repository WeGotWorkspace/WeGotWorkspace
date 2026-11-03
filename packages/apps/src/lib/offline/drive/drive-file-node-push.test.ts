import { beforeEach, describe, expect, it, vi } from "vitest";

const readDriveSyncToken = vi.hoisted(() => vi.fn());
const settleDriveInbound = vi.hoisted(() => vi.fn());
const syncDriveInboundFromFileNodes = vi.hoisted(() => vi.fn());
const listOutboxMutationsForDomain = vi.hoisted(() => vi.fn());
const online = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/offline/drive/drive-inbound-sync", () => ({
  readDriveSyncToken,
  settleDriveInbound,
  syncDriveInboundFromFileNodes,
}));
const withCrossTabLock = vi.hoisted(() =>
  vi.fn((_name: string, task: () => Promise<unknown>) => task()),
);
vi.mock("@/lib/offline/core/outbox-store", () => ({ listOutboxMutationsForDomain }));
vi.mock("@/lib/offline/core/cross-tab-lock", () => ({ withCrossTabLock }));
vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => online.value,
}));

import {
  driveOutboxHasPending,
  subscribeDriveRemoteChanges,
  syncDriveFileNodesIfStale,
} from "./drive-file-node-push";

const USER = "ada";
const CHANGED = { changed: true, listedChanges: true, usedFullResync: false, keptUnsavedPaths: [] };
const UNCHANGED = {
  changed: false,
  listedChanges: false,
  usedFullResync: false,
  keptUnsavedPaths: [],
};
/** A share rooted in someone else's tree: listed, but not placed in the cache. */
const LISTED_ONLY = { ...UNCHANGED, listedChanges: true };

describe("syncDriveFileNodesIfStale", () => {
  beforeEach(() => {
    online.value = true;
    readDriveSyncToken.mockReset().mockResolvedValue("41");
    settleDriveInbound.mockReset().mockResolvedValue(undefined);
    syncDriveInboundFromFileNodes.mockReset().mockResolvedValue(CHANGED);
  });

  it("runs one FileNode/changes for a differing state and tells the listings", async () => {
    const onChange = vi.fn();
    const onSynced = vi.fn();
    const off = subscribeDriveRemoteChanges(USER, onChange);

    await expect(syncDriveFileNodesIfStale(USER, { FileNode: "42" }, onSynced)).resolves.toBe(true);

    expect(syncDriveInboundFromFileNodes).toHaveBeenCalledTimes(1);
    expect(syncDriveInboundFromFileNodes).toHaveBeenCalledWith(USER);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onSynced).toHaveBeenCalledWith(CHANGED);
    off();
  });

  it("syncs one tab at a time, so the next tab finds the token current", async () => {
    await syncDriveFileNodesIfStale(USER, { FileNode: "42" });
    expect(withCrossTabLock).toHaveBeenCalledWith(
      "wgw.drive.file-node-push.ada",
      expect.any(Function),
    );
  });

  it("does not call FileNode/changes for a state equal to the stored token", async () => {
    await expect(syncDriveFileNodesIfStale(USER, { FileNode: "41" })).resolves.toBe(true);
    expect(syncDriveInboundFromFileNodes).not.toHaveBeenCalled();
  });

  it("compares after a sync that was already running, so it does not pull twice", async () => {
    settleDriveInbound.mockImplementation(async () => {
      readDriveSyncToken.mockResolvedValue("42");
    });
    await expect(syncDriveFileNodesIfStale(USER, { FileNode: "42" })).resolves.toBe(true);
    expect(settleDriveInbound).toHaveBeenCalledWith(USER);
    expect(syncDriveInboundFromFileNodes).not.toHaveBeenCalled();
  });

  it("tells the listings about a change it could not place in the cache", async () => {
    syncDriveInboundFromFileNodes.mockResolvedValue(LISTED_ONLY);
    const onChange = vi.fn();
    const off = subscribeDriveRemoteChanges(USER, onChange);
    await syncDriveFileNodesIfStale(USER, { FileNode: "42" });
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
  });

  it("leaves the listings alone when FileNode/changes listed nothing", async () => {
    syncDriveInboundFromFileNodes.mockResolvedValue(UNCHANGED);
    const onChange = vi.fn();
    const off = subscribeDriveRemoteChanges(USER, onChange);
    await syncDriveFileNodesIfStale(USER, { FileNode: "42" });
    expect(onChange).not.toHaveBeenCalled();
    off();
  });

  it("confirms a push without a FileNode state", async () => {
    await expect(syncDriveFileNodesIfStale(USER, { Note: "x" })).resolves.toBe(true);
    expect(readDriveSyncToken).not.toHaveBeenCalled();
  });

  it("does not confirm a failed sync, so the server sends the state again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    syncDriveInboundFromFileNodes.mockRejectedValue(new Error("boom"));
    await expect(syncDriveFileNodesIfStale(USER, { FileNode: "42" })).resolves.toBe(false);
    warn.mockRestore();
  });

  it("does not confirm while offline", async () => {
    online.value = false;
    await expect(syncDriveFileNodesIfStale(USER, { FileNode: "42" })).resolves.toBe(false);
    expect(syncDriveInboundFromFileNodes).not.toHaveBeenCalled();
  });

  it("stops telling a listing after it unsubscribed", async () => {
    const onChange = vi.fn();
    subscribeDriveRemoteChanges(USER, onChange)();
    await syncDriveFileNodesIfStale(USER, { FileNode: "42" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("driveOutboxHasPending", () => {
  beforeEach(() => {
    listOutboxMutationsForDomain.mockReset();
  });

  it("is true while Drive writes wait in the outbox", async () => {
    listOutboxMutationsForDomain.mockResolvedValue([{ id: "1" }]);
    await expect(driveOutboxHasPending(USER)).resolves.toBe(true);
    expect(listOutboxMutationsForDomain).toHaveBeenCalledWith(USER, "drive");
  });

  it("is false with an empty outbox", async () => {
    listOutboxMutationsForDomain.mockResolvedValue([]);
    await expect(driveOutboxHasPending(USER)).resolves.toBe(false);
  });

  it("counts an unreadable cache as pending, so no row is dropped", async () => {
    listOutboxMutationsForDomain.mockRejectedValue(new Error("blocked"));
    await expect(driveOutboxHasPending(USER)).resolves.toBe(true);
  });
});
