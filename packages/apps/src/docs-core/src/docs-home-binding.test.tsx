/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { queryFileTreeView } from "@/lib/files/tree-view/tree-view-query";
import type { FileTreeEntryFilter, FileTreeView } from "@/lib/files/tree-view/tree-view-predicates";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { rememberOfflineDriveUsername } from "@/lib/offline/core/offline-session";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { writeMeta } from "@/lib/offline/core/meta-store";
import { DRIVE_TREE_FIRST_SYNC_DONE_KEY } from "@/lib/offline/drive/drive-tree-sync";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import "@/lib/offline/docs/docs-schema";
import { mergeDocsLabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import {
  DOCS_HOME_ENTRY_FILTER,
  docsHomeTreeView,
  docsHomeWorkspaceConfig,
} from "@/docs-core/src/docs-home-config";
import { useDocsHomeRows } from "@/docs-core/src/use-docs-home-rows";

const hybrid = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const treeCalls = vi.hoisted(() => [] as Array<[string, unknown, unknown]>);

vi.mock("@/lib/offline/drive/drive-hybrid-operations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/offline/drive/drive-hybrid-operations")>();
  return {
    ...actual,
    createHybridDriveOperations: (
      ...args: Parameters<typeof actual.createHybridDriveOperations>
    ) => {
      hybrid.calls.push(args);
      return actual.createHybridDriveOperations(...args);
    },
  };
});

vi.mock("@/lib/files/tree-view/use-file-tree-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/files/tree-view/use-file-tree-view")>();
  return {
    ...actual,
    useFileTreeView: (username: string, view: FileTreeView, filter?: FileTreeEntryFilter) => {
      treeCalls.push([username, view, filter]);
      return { rows: [], status: "ready" as const, settled: true };
    },
  };
});

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({
    listDirectory: vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
    renameItem: vi.fn(),
    setStar: vi.fn(),
    listStars: vi.fn(async () => []),
  })),
}));

const liveSearch = vi.hoisted(() => vi.fn(async () => ({ results: [], hasMore: false, total: 0 })));
vi.mock("@/lib/api/wgw/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/search")>()),
  fetchWgwUnifiedSearch: liveSearch,
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: () => false };
});

const username = "ada";

function entry(path: string, type: "file" | "dir" = "file"): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? path;
  return {
    type,
    name,
    path,
    size: 1,
    time: 1,
    permissions: 0,
    ...(type === "file" ? { extension: name.split(".").pop() } : {}),
  } as WgwDriveDirectoryEntry;
}

const config = docsHomeWorkspaceConfig({
  labels: mergeDocsLabels(),
  username,
  drives: [{ pathPrefix: "users/ada", label: "Personal" }],
});

async function treeIds(view: FileTreeView): Promise<string[]> {
  const result = await queryFileTreeView(username, view, DOCS_HOME_ENTRY_FILTER, false);
  return result.rows.map((row) => row.path.replace(/^\/+/, "")).sort();
}

describe("Docs home binds to the Drive workspace (#2063 C4)", () => {
  beforeEach(async () => {
    hybrid.calls.length = 0;
    treeCalls.length = 0;
    rememberOfflineDriveUsername(username);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.outbox.clear();
    await db.meta.clear();
    await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  });

  it("docs writes use the drive hybrid operations", async () => {
    const { createDocsFileOperations } = await import("@/lib/offline/docs/docs-file-operations");
    const operations = createDocsFileOperations(username);
    expect(hybrid.calls).toHaveLength(1);
    const [account, bootstrap, hooks] = hybrid.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(account).toBe(username);
    expect(bootstrap).toBeNull();
    expect(Object.keys(hooks).sort()).toEqual(["onMoved", "onStarred"]);
    expect(operations.localTree).toBe(true);

    // The Docs offline domain hands out the same operations.
    const { docsDomainOperations } = await import("@/lib/offline/docs/docs-domain-contract");
    docsDomainOperations(username);
    expect(hybrid.calls).toHaveLength(2);

    // An offline trash queues one Drive write and moves the Doc into the tree's Trash.
    await upsertDriveEntry(username, entry("/users/ada", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/.Trash", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/plan.md"));
    await upsertDriveEntry(username, entry("/users/ada/notes.md"));
    await operations.renameItem({
      from: "/users/ada/plan.md",
      destination: "/users/ada/.Trash",
      to: "plan.md",
    });
    await operations.setStar({ path: "/users/ada/notes.md", starred: true });

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const queued = await db.outbox.toArray();
    expect(queued.map((row) => row.domain)).toEqual(["drive", "drive"]);
    expect(await treeIds({ kind: "trash" })).toEqual(["users/ada/.Trash/plan.md"]);
    expect(await treeIds({ kind: "prefix", path: "" })).toEqual(["users/ada/notes.md"]);
    expect(await treeIds({ kind: "starred" })).toEqual(["users/ada/notes.md"]);

    // Moving it out of Trash offline brings it back to All Docs.
    await operations.renameItem({
      from: "/users/ada/.Trash/plan.md",
      destination: "/users/ada",
      to: "plan.md",
    });
    expect(await treeIds({ kind: "trash" })).toEqual([]);
    expect(await treeIds({ kind: "prefix", path: "" })).toEqual([
      "users/ada/notes.md",
      "users/ada/plan.md",
    ]);
  });

  it("docs views are drive views with the docs filter", () => {
    const views: DocsHomeView[] = [
      { type: "all" },
      { type: "recent" },
      { type: "starred" },
      { type: "shared" },
      { type: "trash" },
      { type: "drive", pathPrefix: "users/ada" },
    ];
    for (const view of views) {
      renderHook(() =>
        useDocsHomeRows({
          config,
          treeUsername: username,
          username,
          view,
          query: "",
          online: true,
          personalDriveLabel: "Personal",
        }),
      );
    }
    expect(treeCalls.map(([account]) => account)).toEqual(views.map(() => username));
    expect(treeCalls.map(([, view]) => view)).toEqual(views.map(docsHomeTreeView));
    for (const [, , filter] of treeCalls) {
      expect(filter).toEqual({ extensions: DOCS_HOME_ENTRY_FILTER.extensions, filesOnly: true });
    }
    // A name query narrows the same Drive view on the device; it never swaps the filter.
    treeCalls.length = 0;
    renderHook(() =>
      useDocsHomeRows({
        config,
        treeUsername: username,
        username,
        view: { type: "starred" },
        query: "plan",
        online: true,
        personalDriveLabel: "Personal",
      }),
    );
    expect(treeCalls.at(-1)?.[2]).toEqual({ ...DOCS_HOME_ENTRY_FILTER, nameQuery: "plan" });
  });

  it("searches document text on the server with the live client when online", async () => {
    liveSearch.mockClear();
    renderHook(() =>
      useDocsHomeRows({
        config,
        treeUsername: username,
        username,
        view: { type: "all" },
        query: "roadmap",
        online: true,
        personalDriveLabel: "Personal",
        debounceMs: 0,
      }),
    );
    await waitFor(() => expect(liveSearch).toHaveBeenCalled());
    expect(liveSearch.mock.calls[0]?.[0]).toMatchObject({ q: "roadmap" });
  });
});
