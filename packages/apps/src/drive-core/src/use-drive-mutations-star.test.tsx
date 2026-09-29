import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DriveShellState } from "./use-drive-shell";
import type { DriveListState } from "./use-drive-list";
import { useDriveMutations } from "./use-drive-mutations";

function buildShell(overrides: Partial<DriveShellState> = {}): DriveShellState {
  return {
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
    templatePlugin: null,
    newFileTemplates: [],
    launchPluginEditor: vi.fn(),
    ...overrides,
  } as DriveShellState;
}

function buildList(overrides: Partial<DriveListState> = {}): DriveListState {
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
    queueMutation: vi.fn(),
    beginOptimisticUpdate: vi.fn(),
    ...overrides,
  } as DriveListState;
}

describe("useDriveMutations star toast undo", () => {
  it("shows exactly one undoable toast when starring a file", () => {
    const setStarred = vi.fn();
    const queueMutation = vi.fn();
    const shell = buildShell({ setStarred });
    const list = buildList({ queueMutation });

    const { result } = renderHook(() => useDriveMutations({ shell, list }));

    act(() => {
      result.current.toggleStar("f-1");
    });

    expect(setStarred).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "drive:star:f-1",
        toastMessage: "Starred",
        undoToastMessage: "Star change undone.",
      }),
    );
  });

  it("undo calls setStarred to revert the star state", () => {
    const setStarred = vi.fn();
    const queueMutation = vi.fn();
    const shell = buildShell({ setStarred, starred: { "f-1": true } });
    const list = buildList({ queueMutation });

    const { result } = renderHook(() => useDriveMutations({ shell, list }));

    act(() => {
      result.current.toggleStar("f-1");
    });

    expect(queueMutation).toHaveBeenCalledTimes(1);
    const mutationConfig = queueMutation.mock.calls[0][0];
    expect(mutationConfig.undo).toBeDefined();

    act(() => {
      mutationConfig.undo();
    });

    expect(setStarred).toHaveBeenCalledTimes(2);
    const lastCall = setStarred.mock.calls[1];
    const updater = lastCall[0];
    const updatedState = updater({ "f-1": false });
    expect(updatedState).toEqual({ "f-1": true });
  });
});
