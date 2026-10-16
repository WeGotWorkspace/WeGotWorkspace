/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";

const syncDriveInboundFromFileNodes = vi.hoisted(() => vi.fn());
const showError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/drive/drive-inbound-sync", () => ({
  syncDriveInboundFromFileNodes,
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showError, show: vi.fn(), showSuccess: vi.fn(), dismiss: vi.fn() }),
}));

import { useDriveFileNodeInbound } from "./use-drive-file-node-inbound";

describe("useDriveFileNodeInbound", () => {
  beforeEach(() => {
    syncDriveInboundFromFileNodes.mockReset();
    showError.mockReset();
    syncDriveInboundFromFileNodes.mockResolvedValue({
      changed: true,
      usedFullResync: false,
      keptUnsavedPaths: ["users/ada/unsaved.md"],
    });
  });

  it("shows the unsaved document that a remote delete left in place", async () => {
    renderHook(() => useDriveFileNodeInbound("ada", 0));
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
    expect(showError).toHaveBeenCalledWith(docsLabels.keptUnsavedDocumentTitle, {
      description: docsLabels.keptUnsavedDocumentMessage,
    });
    expect(syncDriveInboundFromFileNodes).toHaveBeenCalledWith("ada");
  });
});
