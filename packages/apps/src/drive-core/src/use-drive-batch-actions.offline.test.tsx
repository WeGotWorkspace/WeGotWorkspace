/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";
import { useDriveBatchActions } from "@/drive-core/src/use-drive-batch-actions";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { createHybridDriveOperations } from "@/lib/offline/drive/drive-hybrid-operations";
import { writeDriveBootstrapToCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return {
    ...actual,
    readBrowserOnline: vi.fn(() => false),
  };
});

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({
    renameItem: vi.fn(),
    createFolder: vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
    listAllDirectoryEntries: vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
    changeDir: vi.fn(),
    listDirectory: vi.fn(),
    refreshState: vi.fn(),
  })),
}));

const USER = "alice";

function bootstrap(): DriveAppBootstrap {
  return {
    session: { user: { username: USER, displayName: USER } },
    data: {
      user: { username: USER, name: USER, role: "user", roots: [] },
      cwd: "/users/alice",
      directory: { location: "/users/alice", files: [] },
      plugins: [],
    },
  };
}

function notesFile(): DriveFile {
  return {
    id: "notes",
    title: "notes.md",
    parent: "My Drive",
    apiPath: "/users/alice/notes.md",
    notebook: "",
    category: "",
    date: "",
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    kind: "file",
    size: "1 KB",
  };
}

describe("useDriveBatchActions offline undo", () => {
  beforeEach(async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(USER));
    await db.outbox.clear();
    await driveEntriesTable(db).clear();
    await db.meta.clear();
    await writeDriveBootstrapToCache(USER, bootstrap());
  });

  afterEach(() => {
    cleanup();
  });

  it("queues the trash restore when the folder listing cannot reach the network", async () => {
    const operations = createHybridDriveOperations(USER, bootstrap());
    const queueMutation = vi.fn();
    const { result } = renderHook(() => {
      const [files, setFiles] = useState<DriveFile[]>([notesFile()]);
      const [selectedIds, setSelectedIds] = useState(["notes"]);
      const [selectionMode, setSelectionMode] = useState(true);
      const [activeId, setActiveId] = useState<string | null>("notes");
      const [, setDetailOpen] = useState(true);
      const [starred, setStarred] = useState<Record<string, boolean>>({});
      return useDriveBatchActions({
        files,
        setFiles,
        selectedIds,
        setSelectedIds,
        selectionMode,
        setSelectionMode,
        activeId,
        setActiveId,
        setDetailOpen,
        starred,
        setStarred,
        currentUsername: USER,
        groupRootNames: new Set(),
        operations,
        queueMutation,
        beginOptimisticUpdate: () => ({
          snapshotById: new Map(),
          affectedItems: [],
          rollback: () => undefined,
        }),
        reloadStarredFromServer: () => undefined,
        view: { type: "folder", path: "My Drive" },
        viewType: "folder",
      });
    });

    act(() => result.current.moveToTrash(["notes"]));
    const queued = queueMutation.mock.calls[0]?.[0] as DeferredApiWriteArgs;
    await act(async () => {
      await queued.execute(new AbortController().signal);
    });
    await act(async () => {
      queued.undo();
      await vi.waitFor(async () => {
        const outbox = await listOutboxMutationsForDomain(USER, DRIVE_DOMAIN);
        expect(outbox.map((row) => row.op)).toEqual(["trash", "rename"]);
      });
    });

    const outbox = await listOutboxMutationsForDomain(USER, DRIVE_DOMAIN);
    expect(JSON.parse(outbox[1]?.payload ?? "{}")).toMatchObject({
      op: "rename",
      from: "/users/alice/.Trash/notes.md",
      destination: "/users/alice",
      to: "notes.md",
    });
  });
});
