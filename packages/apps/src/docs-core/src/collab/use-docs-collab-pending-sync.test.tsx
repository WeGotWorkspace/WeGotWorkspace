import "fake-indexeddb/auto";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setDocsCollabSyncState,
  clearDocsCollabSyncState,
} from "@/text-editor-core/docs-collab/docs-collab-sync-registry";
import { useDocsCollabPendingSync } from "./use-docs-collab-pending-sync";
import { useDocsCollabFailedSync } from "./use-docs-collab-failed-sync";

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
}));

describe("useDocsCollabPendingSync", () => {
  beforeEach(() => {
    clearDocsCollabSyncState("docs/test.md");
  });

  it("returns false when no room is provided", () => {
    const { result } = renderHook(() => useDocsCollabPendingSync(null));
    expect(result.current).toBe(false);
  });

  it("returns true when the room has a pending server save", () => {
    setDocsCollabSyncState("docs/test.md", { pendingServerSave: true });
    const { result } = renderHook(() => useDocsCollabPendingSync("docs/test.md"));
    expect(result.current).toBe(true);
  });
});

describe("useDocsCollabFailedSync", () => {
  beforeEach(() => {
    clearDocsCollabSyncState("docs/test.md");
  });

  it("returns false when pending but save has not failed", () => {
    setDocsCollabSyncState("docs/test.md", { pendingServerSave: true, failedSync: false });
    const { result } = renderHook(() => useDocsCollabFailedSync("docs/test.md"));
    expect(result.current).toBe(false);
  });

  it("returns true when pending and save failed while online", () => {
    setDocsCollabSyncState("docs/test.md", { pendingServerSave: true, failedSync: true });
    const { result } = renderHook(() => useDocsCollabFailedSync("docs/test.md"));
    expect(result.current).toBe(true);
  });
});
