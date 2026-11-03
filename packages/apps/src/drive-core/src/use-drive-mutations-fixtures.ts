import { vi } from "vitest";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";
import type { DriveListState } from "@/drive-core/src/use-drive-list";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";

/** Shell and list stubs for `useDriveMutations` hook tests. */
export function buildShell(overrides: Partial<DriveShellState> = {}): DriveShellState {
  return {
    data: createDriveAppBootstrap().data,
    labels: {},
    files: [
      {
        id: "f-1",
        notebook: "File",
        category: "doc",
        date: "Now",
        title: "test.txt",
        excerpt: "Test file",
        body: [],
        tags: [],
        wordCount: 0,
        parent: "My Drive",
        kind: "doc",
        size: "1 KB",
      },
    ],
    setFiles: vi.fn(),
    view: { type: "folder", path: "My Drive" },
    commitView: vi.fn(),
    currentUsername: "testuser",
    groupRootNames: [],
    operations: {
      setStar: vi.fn().mockResolvedValue(undefined),
      renameItem: vi.fn(),
      uploadFiles: vi.fn(),
      checkUploadReady: vi.fn(),
      createFolder: vi.fn(),
      createFile: vi.fn(),
      refreshState: vi.fn(),
      changeDir: vi.fn(),
      listDirectory: vi.fn(),
      search: vi.fn(),
      deleteItems: vi.fn(),
      downloadFile: vi.fn(),
      readFileBlob: vi.fn(),
      listStars: vi.fn(),
      listEntriesByPaths: vi.fn(),
    } as DriveShellState["operations"],
    starred: {},
    setStarred: vi.fn(),
    reloadStarredFromServer: vi.fn(),
    inTrashView: false,
    isUnderTrash: vi.fn(() => false),
    ...overrides,
  } as DriveShellState;
}

export function buildList(overrides: Partial<DriveListState> = {}): DriveListState {
  return {
    selectedIds: [],
    setSelectedIds: vi.fn(),
    selectionMode: false,
    setSelectionMode: vi.fn(),
    activeId: "",
    setActiveId: vi.fn(),
    setDetailOpen: vi.fn(),
    fileById: (id: string) => {
      const file = {
        id: "f-1",
        notebook: "File",
        category: "doc",
        date: "Now",
        title: "test.txt",
        excerpt: "Test file",
        body: [],
        tags: [],
        wordCount: 0,
        parent: "My Drive",
        kind: "doc" as const,
        size: "1 KB",
      };
      return id === "f-1" ? file : null;
    },
    exitSelection: vi.fn(),
    dropZoneProps: vi.fn(),
    itemDragHandlers: vi.fn(() => ({ onDragStart: vi.fn(), onDragEnd: vi.fn() })),
    queueMutation: vi.fn(),
    beginOptimisticUpdate: vi.fn(),
    ...overrides,
  } as DriveListState;
}
