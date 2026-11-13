/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { driveInboundLabels } from "@/lib/offline/drive/drive-inbound-labels";

const syncDriveInboundFromFileNodes = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/drive/drive-inbound-sync", () => ({
  syncDriveInboundFromFileNodes,
}));

const guestSession = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/api/wgw/http", () => ({ wgwIsGuestSession: () => guestSession.value }));

const syncDriveFileNodesIfStale = vi.hoisted(() => vi.fn());
const useJmapStateChange = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/drive/drive-file-node-push", () => ({ syncDriveFileNodesIfStale }));
vi.mock("@/lib/api/wgw/use-jmap-state-change", () => ({ useJmapStateChange }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show, showError: vi.fn(), showSuccess: vi.fn(), dismiss: vi.fn() }),
}));

import { useDriveFileNodeInbound } from "./use-drive-file-node-inbound";

describe("useDriveFileNodeInbound", () => {
  beforeEach(() => {
    guestSession.value = false;
    syncDriveInboundFromFileNodes.mockReset();
    show.mockReset();
    syncDriveFileNodesIfStale.mockReset().mockResolvedValue(true);
    useJmapStateChange.mockReset();
    syncDriveInboundFromFileNodes.mockResolvedValue({
      changed: true,
      usedFullResync: false,
      keptUnsavedPaths: ["users/ada/unsaved.md"],
    });
  });

  it("shows the unsaved document that a remote delete left in place", async () => {
    renderHook(() => useDriveFileNodeInbound("ada", 0));
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show).toHaveBeenCalledWith(driveInboundLabels.keptUnsavedDocumentTitle, {
      description: "Your unsaved copy of /users/ada/unsaved.md is still here.",
    });
    expect(syncDriveInboundFromFileNodes).toHaveBeenCalledWith("ada");
  });

  it("logs a sync failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("inbound failed");
    syncDriveInboundFromFileNodes.mockRejectedValue(failure);
    renderHook(() => useDriveFileNodeInbound("ada", 1));
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith("[drive-inbound] FileNode sync failed", failure);
    expect(show).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports each pull as settled, failed ones too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSettled = vi.fn();
    const { rerender } = renderHook(({ key }) => useDriveFileNodeInbound("ada", key, onSettled), {
      initialProps: { key: 3 },
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(3));

    syncDriveInboundFromFileNodes.mockRejectedValueOnce(new Error("offline"));
    rerender({ key: 4 });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(4));
    warn.mockRestore();
  });

  it("never syncs for a share-link guest, whose shell username is the owner's", async () => {
    guestSession.value = true;
    renderHook(() => useDriveFileNodeInbound("owner", 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncDriveInboundFromFileNodes).not.toHaveBeenCalled();
    // Nor does it listen for pushed FileNode states.
    const [types] = useJmapStateChange.mock.calls.at(-1)!;
    expect(types).toEqual([]);
  });

  it("runs a pushed FileNode state through the push sync (#1663)", async () => {
    renderHook(() => useDriveFileNodeInbound("ada", 0));
    const [types, listener] = useJmapStateChange.mock.calls.at(-1)!;
    expect(types).toEqual(["FileNode"]);

    await expect(listener({ FileNode: "42" }, "acc")).resolves.toBe(true);
    expect(syncDriveFileNodesIfStale).toHaveBeenCalledWith(
      "ada",
      { FileNode: "42" },
      expect.any(Function),
    );
  });

  it("does not subscribe without an offline account", () => {
    renderHook(() => useDriveFileNodeInbound(null, 0));
    const [types] = useJmapStateChange.mock.calls.at(-1)!;
    expect(types).toEqual([]);
  });
});
