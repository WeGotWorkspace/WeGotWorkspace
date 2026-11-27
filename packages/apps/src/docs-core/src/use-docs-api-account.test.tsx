import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocsAppBootstrap } from "@/lib/api/mock/docs-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { readOfflineDocsUsername } from "@/lib/offline/core/offline-session";
import type { DocsApiSource } from "./docs-api-source";
import { useDocsAPI } from "./use-docs-api";

const http = vi.hoisted(() => ({ live: true, guest: false }));
vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwLiveApiEnabled: () => http.live,
  wgwIsGuestSession: () => http.guest,
}));
// The sync that follows a ready bootstrap is not under test here.
vi.mock("@/lib/offline/docs/docs-sync-runner", () => ({
  getDocsSyncRunner: () => ({ flush: async () => undefined }),
}));
vi.mock("@/lib/offline/drive/drive-hybrid-operations", () => ({
  getDriveSyncRunner: () => ({ flush: async () => undefined }),
}));
vi.mock("@/lib/offline/drive/drive-inbound-sync", () => ({
  syncDriveInboundFromFileNodes: async () => ({ changed: false, listedChanges: false }),
}));
vi.mock("@/docs-core/src/docs-pending-bodies", () => ({
  uploadPendingDocBodies: async () => undefined,
}));
vi.mock("@/lib/offline/docs/docs-body-sync", () => ({
  requestDocsBodySyncFromTree: async () => undefined,
}));

function source(username: string): DocsApiSource {
  const bootstrap = createDocsAppBootstrap({
    session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
  });
  return {
    loadBootstrap: vi.fn().mockResolvedValue(bootstrap),
    createNetworkOperations: () => ({ loadFile: vi.fn(), saveFile: vi.fn(), renameFile: vi.fn() }),
    createOperations: () => undefined,
  };
}

describe("useDocsAPI remembers the Docs account (#2063)", () => {
  beforeEach(() => {
    localStorage.clear();
    http.live = true;
    http.guest = false;
  });

  it("remembers the signed-in account, so the next cold open reads the tree before its bootstrap answers", async () => {
    const { result } = renderHook(() => useDocsAPI(source("ada")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(readOfflineDocsUsername()).toBe("ada");
  });

  it("never remembers a share guest's account", async () => {
    http.guest = true;
    const { result } = renderHook(() => useDocsAPI(source("owner")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(readOfflineDocsUsername()).toBeNull();
  });
});
