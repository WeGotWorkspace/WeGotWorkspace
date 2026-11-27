/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { applyDocsStarToggle, writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import { driveEntryRowFromEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import type { DriveEntryArea } from "@/lib/offline/drive/drive-tree-rows";
import {
  DRIVE_TREE_CRAWL_ROOTS_KEY,
  DRIVE_TREE_FIRST_SYNC_DONE_KEY,
  DRIVE_TREE_LAST_PASS_KEY,
  DRIVE_TREE_ROOTS_KEY,
} from "@/lib/offline/drive/drive-tree-sync";
import type { FileTreeEntryFilter, FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";

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

import { useFileTreeView } from "@/lib/files/tree-view/use-file-tree-view";

let username = "ada";
let accountCounter = 0;

function table() {
  return driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
}

function entry(path: string, time = 1): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? "";
  const isFile = name.includes(".", 1);
  return {
    type: isFile ? "file" : "dir",
    path: `/${path}`,
    name,
    size: 1,
    time,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

async function put(path: string, area?: DriveEntryArea, time = 1) {
  await table().put(driveEntryRowFromEntry(entry(path, time), area));
}

async function finishFirstSync() {
  await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  await writeMeta(
    username,
    DRIVE_TREE_ROOTS_KEY,
    JSON.stringify({ "r-home": "/users/ada", "r-team": "/groups/team" }),
  );
}

function setOnline(online: boolean) {
  connectivity.online = online;
  act(() => {
    for (const listener of connectivity.listeners) listener();
  });
}

function render(view: FileTreeView, filter?: FileTreeEntryFilter) {
  return renderHook(
    ({ v, f }: { v: FileTreeView; f?: FileTreeEntryFilter }) => useFileTreeView(username, v, f),
    { initialProps: { v: view, f: filter } },
  );
}

async function settled(result: { current: ReturnType<typeof useFileTreeView> }) {
  await waitFor(() => expect(result.current.settled).toBe(true));
  return result.current;
}

function paths(rows: readonly WgwDriveDirectoryEntry[]): string[] {
  return rows.map((row) => row.path).sort();
}

beforeEach(() => {
  accountCounter += 1;
  username = `ada${accountCounter}`;
  connectivity.online = true;
});

afterEach(() => cleanup());

describe("useFileTreeView", () => {
  it("unsynced folder is not-available, not empty", async () => {
    connectivity.online = false;
    const { result } = render({ kind: "folder", path: "users/ada/Plans" });
    expect(await settled(result)).toEqual({ rows: [], status: "not-available", settled: true });

    // After a complete pass, a folder the pass does not know stays not-available.
    await finishFirstSync();
    const after = render({ kind: "folder", path: "users/ada/Never" });
    expect((await settled(after.result)).status).toBe("not-available");
  });

  it("a deep link to a folder the finished tree does not hold is not-available online", async () => {
    await finishFirstSync();
    const { result } = render({ kind: "folder", path: "users/ada/Never" });
    expect(await settled(result)).toEqual({ rows: [], status: "not-available", settled: true });

    const prefix = render({ kind: "prefix", path: "groups/gone" });
    expect((await settled(prefix.result)).status).toBe("not-available");
  });

  it("after a per-folder crawl, only the roots it queued are known, plus Trash and Shared", async () => {
    // As crawlFolders leaves it: no roots map, no firstSyncDone, the queued root
    // paths, last pass "crawl".
    await writeMeta(username, DRIVE_TREE_LAST_PASS_KEY, "crawl");
    await writeMeta(
      username,
      DRIVE_TREE_CRAWL_ROOTS_KEY,
      JSON.stringify([`/users/${username}`, "/groups/team"]),
    );
    for (const path of [`users/${username}`, "groups/team"]) {
      const { result } = render({ kind: "folder", path });
      expect(await settled(result), path).toEqual({ rows: [], status: "ready", settled: true });
    }
    for (const view of [
      { kind: "folder", path: `users/${username}/Never` },
      { kind: "folder", path: "groups/other" },
      { kind: "prefix", path: "groups/other" },
    ] as const) {
      const { result } = render(view);
      expect((await settled(result)).status, JSON.stringify(view)).toBe("not-available");
    }
    // The crawl stores each root's `.Trash` and the share roots: empty is empty.
    for (const view of [{ kind: "trash" }, { kind: "shared" }] as const) {
      const { result } = render(view);
      expect(await settled(result), view.kind).toEqual({
        rows: [],
        status: "ready",
        settled: true,
      });
    }

    // The crawl's rows are complete for what it lists: All files is ready, never an endless first-sync.
    await put(`users/${username}/a.md`, "home");
    const all = render({ kind: "all" });
    const state = await settled(all.result);
    expect(state.status).toBe("ready");
    expect(paths(state.rows)).toEqual([`/users/${username}/a.md`]);
  });

  it("first sync with no rows online is the full-pane first-sync state", async () => {
    const { result } = render({ kind: "folder", path: "users/ada" });
    expect(await settled(result)).toMatchObject({ rows: [], status: "first-sync" });
  });

  it("offline during a first sync shows the rows that already arrived", async () => {
    connectivity.online = false;
    await put("users/ada/a.md");
    const { result } = render({ kind: "folder", path: "users/ada" });
    const state = await settled(result);
    expect(state.status).toBe("first-sync");
    expect(paths(state.rows)).toEqual(["/users/ada/a.md"]);
  });

  it("a folder synced with zero entries is known-empty", async () => {
    connectivity.online = false;
    await finishFirstSync();
    await put("users/ada/Empty", "home");
    const { result } = render({ kind: "folder", path: "/users/ada/Empty" });
    expect(await settled(result)).toEqual({ rows: [], status: "ready", settled: true });

    const root = render({ kind: "folder", path: "groups/team" });
    expect((await settled(root.result)).status).toBe("ready");
  });

  it("area views stay in the first-sync state while rows have no area yet", async () => {
    await put("users/ada/.Trash/old.md");
    await put("users/bob/shared.md");
    for (const view of [{ kind: "trash" }, { kind: "shared" }, { kind: "all" }] as const) {
      const { result } = render(view);
      expect(await settled(result), view.kind).toMatchObject({ rows: [], status: "first-sync" });
    }
  });

  it("lists every view from the indexed columns after a complete pass", async () => {
    await finishFirstSync();
    await put("users/ada/Plans", "home");
    await put("users/ada/Plans/a.md", "home", 30);
    await put("users/ada/b.png", "home", 20);
    await put("users/ada/.notes/body.md", "home", 99);
    await put("groups/team/Launch/c.md", "group", 10);
    await put("users/ada/.Trash/old.md", "trash", 50);
    await put("users/bob/Shared", "share");
    await put("users/bob/Shared/inner.md", "share", 40);

    const expectRows = async (
      view: FileTreeView,
      expected: string[],
      filter?: FileTreeEntryFilter,
    ) => {
      const { result } = render(view, filter);
      const state = await settled(result);
      expect(state.status, JSON.stringify(view)).toBe("ready");
      expect(paths(state.rows), JSON.stringify(view)).toEqual(expected);
    };

    await expectRows({ kind: "folder", path: "users/ada" }, [
      "/users/ada/Plans",
      "/users/ada/b.png",
    ]);
    await expectRows({ kind: "all" }, [
      "/groups/team/Launch/c.md",
      "/users/ada/Plans/a.md",
      "/users/ada/b.png",
    ]);
    await expectRows({ kind: "all" }, ["/groups/team/Launch/c.md", "/users/ada/Plans/a.md"], {
      extensions: ["md"],
    });
    await expectRows({ kind: "trash" }, ["/users/ada/.Trash/old.md"]);
    await expectRows({ kind: "shared" }, ["/users/bob/Shared"]);
    await expectRows({ kind: "prefix", path: "groups/team" }, ["/groups/team/Launch/c.md"]);
    await expectRows({ kind: "folder", path: "users/ada" }, ["/users/ada/b.png"], {
      nameQuery: "B.P",
    });

    const recent = render({ kind: "recent", limit: 2 });
    expect((await settled(recent.result)).rows.map((row) => row.path)).toEqual([
      "/users/bob/Shared/inner.md",
      "/users/ada/Plans/a.md",
    ]);

    await writeDocsStarredPaths(username, ["/users/ada/Plans/a.md", "/users/ada/.Trash/old.md"]);
    await expectRows({ kind: "starred" }, ["/users/ada/Plans/a.md"]);
  });

  it("re-queries when the drive cache changes", async () => {
    await finishFirstSync();
    const { result } = render({ kind: "folder", path: "users/ada" });
    expect((await settled(result)).rows).toEqual([]);

    await put("users/ada/new.md", "home");
    act(() => notifyDriveRemoteChange(username));
    await waitFor(() => expect(paths(result.current.rows)).toEqual(["/users/ada/new.md"]));
  });

  it("re-reads the starred view when the star set changes, with no drive notify", async () => {
    await finishFirstSync();
    await put("users/ada/a.md", "home");
    const { result } = render({ kind: "starred" });
    expect((await settled(result)).rows).toEqual([]);

    // As Drive's setStar writes it: the star store alone, no drive cache notify.
    await act(() => applyDocsStarToggle(username, "/users/ada/a.md", true));
    await waitFor(() => expect(paths(result.current.rows)).toEqual(["/users/ada/a.md"]));
  });

  it("a failed re-read keeps the list on screen", async () => {
    await finishFirstSync();
    await put("users/ada/a.md", "home");
    const { result } = render({ kind: "folder", path: "users/ada" });
    expect(paths((await settled(result)).rows)).toEqual(["/users/ada/a.md"]);

    const broken = driveEntryRowFromEntry(entry("users/ada/b.md"), "home");
    await table().put({ ...broken, data: "{" });
    act(() => notifyDriveRemoteChange(username));
    // Give the failing read time to answer; the list stays.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toMatchObject({ status: "ready", settled: true });
    expect(paths(result.current.rows)).toEqual(["/users/ada/a.md"]);
  });

  it("an unreadable cache with nothing shown is not-available, online too", async () => {
    const broken = driveEntryRowFromEntry(entry("users/ada/b.md"));
    await table().put({ ...broken, data: "{" });
    const { result } = render({ kind: "folder", path: "users/ada" });
    expect(await settled(result)).toEqual({ rows: [], status: "not-available", settled: true });
  });

  it("re-reads the status when connectivity flips", async () => {
    const { result } = render({ kind: "folder", path: "users/ada" });
    expect((await settled(result)).status).toBe("first-sync");
    setOnline(false);
    await waitFor(() => expect(result.current.status).toBe("not-available"));
  });

  it("a new view starts unsettled instead of showing the previous view's rows", async () => {
    await finishFirstSync();
    await put("users/ada/a.md", "home");
    const { result, rerender } = render({ kind: "folder", path: "users/ada" });
    expect((await settled(result)).rows).toHaveLength(1);
    rerender({ v: { kind: "trash" }, f: undefined });
    expect(result.current).toEqual({ rows: [], status: "first-sync", settled: false });
    expect(await settled(result)).toEqual({ rows: [], status: "ready", settled: true });
  });
});
