/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import type { ViewKey } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";
import { writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import { driveEntryRowFromEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveEntryArea } from "@/lib/offline/drive/drive-tree-rows";
import {
  DRIVE_TREE_FIRST_SYNC_DONE_KEY,
  DRIVE_TREE_ROOTS_KEY,
} from "@/lib/offline/drive/drive-tree-sync";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";

const connectivity = vi.hoisted(() => ({
  online: true,
  listeners: new Set<() => void>(),
}));

vi.mock("@/lib/offline/core/browser-online", async () => ({
  ...(await vi.importActual<object>("@/lib/offline/core/browser-online")),
  getConnectivitySnapshot: () => connectivity.online,
  subscribeBrowserOnline: (listener: () => void) => {
    connectivity.listeners.add(listener);
    return () => connectivity.listeners.delete(listener);
  },
}));

const toast = vi.hoisted(() => ({
  show: () => {},
  showError: () => {},
  showSuccess: () => {},
  dismiss: () => {},
}));
vi.mock("@/hooks/use-app-toast", () => ({ useAppToast: () => toast }));

import { useDriveShell } from "@/drive-core/src/use-drive-shell";

let user = "ada";
let accountCounter = 0;

function table() {
  return driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(user)));
}

function entry(path: string, time = 1): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? "";
  return {
    type: name.includes(".", 1) ? "file" : "dir",
    path: `/${path}`,
    name,
    size: 1,
    time,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

async function put(path: string, area: DriveEntryArea, time = 1) {
  await table().put(driveEntryRowFromEntry(entry(path, time), area));
}

async function finishFirstSync() {
  await writeMeta(user, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  await writeMeta(user, DRIVE_TREE_ROOTS_KEY, JSON.stringify({ "r-home": `/users/${user}` }));
}

function operations(): DriveAPIOperations {
  return {
    localTree: true,
    refreshState: vi.fn(),
    changeDir: vi.fn().mockRejectedValue(new Error("no folder listing on the tree")),
    listDirectory: vi.fn().mockRejectedValue(new Error("no folder listing on the tree")),
    search: vi.fn().mockResolvedValue([entry(`users/${user}/server-hit.md`)]),
    createFolder: vi.fn(),
    createFile: vi.fn(),
    renameItem: vi.fn(),
    deleteItems: vi.fn(),
    downloadFile: vi.fn(),
    readFileBlob: vi.fn(),
    checkUploadReady: vi.fn(),
    listStars: vi.fn().mockResolvedValue([]),
    listEntriesByPaths: vi.fn().mockRejectedValue(new Error("no starred listing on the tree")),
    setStar: vi.fn(),
    uploadFiles: vi.fn(),
  };
}

function data(): DriveUIData {
  return {
    user: { username: user, name: user, role: "user", roots: ["/users"] },
    cwd: `/users/${user}`,
    directory: { location: `/users/${user}`, files: [] },
  };
}

function renderShell(view: ViewKey, ops = operations()) {
  const session: WorkspaceSession = {
    user: { displayName: user, initials: "A", username: user },
    viewerInboxLabel: user,
  };
  const hook = renderHook(
    ({ v }: { v: ViewKey }) =>
      useDriveShell({ data: data(), session, operations: ops, view: v, onViewChange: vi.fn() }),
    { initialProps: { v: view } },
  );
  return { ...hook, ops };
}

function titles(rows: readonly { title: string }[] | null): string[] {
  return (rows ?? []).map((row) => row.title).sort();
}

describe("Drive views on the local file tree (#2063 C3)", () => {
  beforeEach(() => {
    accountCounter += 1;
    user = `c3user${accountCounter}`;
    connectivity.online = true;
  });

  afterEach(() => cleanup());

  it("opens a synced folder from the tree with no folder listing and no loading state", async () => {
    await put(`users/${user}/Projects`, "home");
    await put(`users/${user}/Projects/plan.md`, "home");
    await finishFirstSync();
    const { result, ops } = renderShell({ type: "folder", path: "My Drive/Projects" });

    await waitFor(() => expect(titles(result.current.files)).toEqual(["plan.md"]));
    expect(result.current.viewState).toBeNull();
    expect(ops.changeDir).not.toHaveBeenCalled();
  });

  it("shows a known-empty folder as empty, not loading", async () => {
    await put(`users/${user}/Empty`, "home");
    await finishFirstSync();
    const { result } = renderShell({ type: "folder", path: "My Drive/Empty" });

    await waitFor(() => expect(result.current.viewState).toBeNull());
    expect(result.current.files.filter((f) => f.parent === "My Drive/Empty")).toEqual([]);
  });

  it("is in the first-sync state online before the first sync, with no rows", async () => {
    const { result } = renderShell({ type: "all" });

    await waitFor(() => expect(result.current.viewState).toBe("first-sync"));
  });

  it("is not available offline before the first sync, never empty", async () => {
    connectivity.online = false;
    const { result } = renderShell({ type: "folder", path: "My Drive" });

    await waitFor(() => expect(result.current.viewState).toBe("not-available"));
  });

  it("shows a never-synced folder as not available offline after the first sync", async () => {
    connectivity.online = false;
    await finishFirstSync();
    const { result } = renderShell({ type: "folder", path: "My Drive/Nowhere" });

    await waitFor(() => expect(result.current.viewState).toBe("not-available"));
  });

  it("reads All Files, Starred, Shared and Trash from the tree", async () => {
    await put(`users/${user}/a.md`, "home", 2);
    await put(`groups/team/b.md`, "group", 3);
    await put(`users/bob/deck.md`, "share");
    await put(`users/${user}/.Trash/old.md`, "trash");
    await writeDocsStarredPaths(user, [`/users/${user}/a.md`]);
    await finishFirstSync();

    const { result, rerender, ops } = renderShell({ type: "all" });
    await waitFor(() => expect(titles(result.current.viewItems)).toEqual(["a.md", "b.md"]));
    // Newest first.
    expect(result.current.viewItems?.[0]?.title).toBe("b.md");

    rerender({ v: { type: "starred" } });
    await waitFor(() => expect(titles(result.current.viewItems)).toEqual(["a.md"]));
    expect(ops.listEntriesByPaths).not.toHaveBeenCalled();

    rerender({ v: { type: "shared" } });
    await waitFor(() => expect(titles(result.current.viewItems)).toEqual(["deck.md"]));
    expect(result.current.viewItems?.[0]?.parent).toBe("Shared with me");

    rerender({ v: { type: "folder", path: "Trash" } });
    await waitFor(() => expect(titles(result.current.files)).toEqual(["old.md"]));
    expect(result.current.files[0]?.parent).toBe("Trash");
    expect(ops.changeDir).not.toHaveBeenCalled();
  });

  it("filters names on the device offline and keeps the server search online", async () => {
    await put(`users/${user}/Budget.xlsx`, "home");
    await put(`users/${user}/notes.md`, "home");
    await finishFirstSync();
    connectivity.online = false;
    const { result, ops } = renderShell({ type: "all" });

    act(() => result.current.setSearchQuery("budg"));
    await waitFor(() => expect(titles(result.current.liveSearchResults)).toEqual(["Budget.xlsx"]));
    expect(ops.search).not.toHaveBeenCalled();

    connectivity.online = true;
    act(() => {
      for (const listener of connectivity.listeners) listener();
    });
    await waitFor(() => expect(ops.search).toHaveBeenCalledWith("budg", expect.anything()));
    await waitFor(() =>
      expect(titles(result.current.liveSearchResults)).toEqual(["server-hit.md"]),
    );
  });
});
