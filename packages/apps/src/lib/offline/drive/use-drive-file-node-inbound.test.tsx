/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";

const syncDriveInboundFromFileNodes = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/drive/drive-inbound-sync", () => ({
  syncDriveInboundFromFileNodes,
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show, showError: vi.fn(), showSuccess: vi.fn(), dismiss: vi.fn() }),
}));

import { useDriveFileNodeInbound } from "./use-drive-file-node-inbound";

describe("useDriveFileNodeInbound", () => {
  beforeEach(() => {
    syncDriveInboundFromFileNodes.mockReset();
    show.mockReset();
    syncDriveInboundFromFileNodes.mockResolvedValue({
      changed: true,
      usedFullResync: false,
      keptUnsavedPaths: ["users/ada/unsaved.md"],
    });
  });

  it("shows the unsaved document that a remote delete left in place", async () => {
    renderHook(() => useDriveFileNodeInbound("ada", 0));
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show).toHaveBeenCalledWith(docsLabels.keptUnsavedDocumentTitle, {
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
});
