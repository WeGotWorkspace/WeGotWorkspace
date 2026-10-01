import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  captureOfflineDocsTrashSnapshot,
  undoOfflineDocsTrash,
} from "@/lib/offline/docs/docs-hybrid-operations";
import { removeOutboxMutationsForDocsPath } from "@/lib/offline/docs/docs-outbox-flush";
import { useDocsHomeActions } from "@/docs-core/src/use-docs-home-actions";

const queueMutation = vi.fn();
const undoLatest = vi.fn(() => false);
const { showToast, showErrorToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock("@/hooks/use-queued-mutation", () => ({
  useQueuedMutation: () => ({ queueMutation, undoLatest }),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: showToast,
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: showErrorToast,
  }),
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return {
    ...actual,
    readBrowserOnline: vi.fn(() => true),
  };
});

vi.mock("@/lib/offline/docs/docs-outbox-flush", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/docs/docs-outbox-flush")>();
  return {
    ...actual,
    removeOutboxMutationsForDocsPath: vi.fn(async () => false),
  };
});

vi.mock("@/lib/offline/docs/docs-hybrid-operations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/docs/docs-hybrid-operations")>();
  return {
    ...actual,
    captureOfflineDocsTrashSnapshot: vi.fn(async (_username: string, apiPath: string) => ({
      apiPath,
      listingResult: {
        id: 1,
        sourceType: "file",
        sourceKey: apiPath.replace(/^\/+/, ""),
        title: apiPath.split("/").pop() ?? apiPath,
        size: 1,
      },
      availability: { id: apiPath.replace(/^\/+/, ""), location: "My Drive" },
    })),
    undoOfflineDocsTrash: vi.fn(async () => undefined),
  };
});

function file(partial: Partial<DriveFile> & { id: string; apiPath: string }): DriveFile {
  return {
    category: "document",
    date: "Now",
    title: partial.title ?? partial.id,
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "—",
    ...partial,
  };
}

const FILES: DriveFile[] = [
  file({ id: "search:file:users/alice/A.md", title: "A.md", apiPath: "/users/alice/A.md" }),
  file({ id: "search:file:users/alice/B.md", title: "B.md", apiPath: "/users/alice/B.md" }),
];

type MockOperations = DriveAPIOperations & {
  listStars: ReturnType<typeof vi.fn>;
  setStar: ReturnType<typeof vi.fn>;
  downloadFile: ReturnType<typeof vi.fn>;
  renameItem: ReturnType<typeof vi.fn>;
  deleteItems: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  listAllDirectoryEntries: ReturnType<typeof vi.fn>;
};

function listedFile(path: string, name = path.split("/").pop() ?? path) {
  return {
    name,
    path,
    type: "file" as const,
    size: 1,
    time: 0,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

function createMockOperations(starredPaths: string[] = []): MockOperations {
  const data = {} as DriveUIData;
  return {
    listStars: vi.fn(async () => starredPaths),
    setStar: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => undefined),
    renameItem: vi.fn(async () => data),
    deleteItems: vi.fn(async () => data),
    createFolder: vi.fn(async () => data),
    listAllDirectoryEntries: vi.fn(async () => []),
  } as unknown as MockOperations;
}

function renderActions(
  operations: MockOperations,
  reload = vi.fn(),
  options?: {
    offlineUsername?: string;
    onAvailabilityChanged?: () => void;
    inTrashView?: boolean;
    files?: typeof FILES;
  },
) {
  return renderHook(() =>
    useDocsHomeActions({
      operations,
      files: options?.files ?? FILES,
      username: "alice",
      groupRoots: [],
      offlineUsername: options?.offlineUsername ?? null,
      onAvailabilityChanged: options?.onAvailabilityChanged,
      reload,
      inTrashView: options?.inTrashView ?? false,
    }),
  );
}

describe("useDocsHomeActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
  });

  it("derives the starred map from listStars keyed by file id", async () => {
    const operations = createMockOperations(["/users/alice/A.md"]);
    const { result } = renderActions(operations);

    await waitFor(() => expect(result.current.starred["search:file:users/alice/A.md"]).toBe(true));
    expect(result.current.starred["search:file:users/alice/B.md"]).toBeUndefined();
  });

  it("toggles a star optimistically and persists via setStar", async () => {
    const operations = createMockOperations(["/users/alice/A.md"]);
    const { result } = renderActions(operations);
    await waitFor(() => expect(result.current.starred["search:file:users/alice/A.md"]).toBe(true));

    act(() => result.current.onStar("search:file:users/alice/A.md"));

    expect(result.current.starred["search:file:users/alice/A.md"]).toBeUndefined();
    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queueMutation.mock.calls[0]?.[0]).toMatchObject({
      key: "docs:star:search:file:users/alice/A.md",
      toastMessage: "Unstarred",
      undoToastMessage: "Star change undone.",
    });

    const execute = queueMutation.mock.calls[0]?.[0]?.execute as (
      signal: AbortSignal,
    ) => Promise<void>;
    await act(async () => {
      await execute(new AbortController().signal);
    });
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/A.md", starred: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("downloads via the file api path", () => {
    const operations = createMockOperations();
    const { result } = renderActions(operations);

    act(() => result.current.onDownload(FILES[1]!));
    expect(operations.downloadFile).toHaveBeenCalledWith("/users/alice/B.md");
  });

  it("renames within the same folder and refreshes the list", async () => {
    const operations = createMockOperations();
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onRename(FILES[0]!));
    expect(result.current.renameName).toBe("A");

    act(() => result.current.setRenameName("Renamed"));
    act(() => result.current.submitRename());

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenCalledWith({
        destination: "/users/alice",
        from: "/users/alice/A.md",
        to: "Renamed.md",
      }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("moves a file to the resolved destination and refreshes", async () => {
    const operations = createMockOperations();
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onMove(FILES[0]!));
    act(() => result.current.confirmMove("My Drive/Projects"));

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenCalledWith({
        destination: "/users/alice/Projects",
        from: "/users/alice/A.md",
        to: "A.md",
      }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("moves a file to Trash via queued mutation with undo", async () => {
    const operations = createMockOperations();
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    expect(result.current.hiddenFileIds.has("search:file:users/alice/B.md")).toBe(true);
    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queueMutation.mock.calls[0]?.[0]).toMatchObject({
      key: "docs:trash:search:file:users/alice/B.md",
      undoToastMessage: "Move to trash undone.",
      executeImmediately: true,
    });

    const execute = queueMutation.mock.calls[0]?.[0]?.execute as (
      signal: AbortSignal,
    ) => Promise<void>;
    await act(async () => {
      await execute(new AbortController().signal);
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/B.md",
        to: "B.md",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(operations.createFolder).toHaveBeenCalledWith(
      { cwd: "/users/alice", name: ".Trash" },
      expect.objectContaining({ signal: expect.any(AbortSignal), refreshState: false }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it("still trashes when createFolder reports the trash folder already exists", async () => {
    const operations = createMockOperations();
    operations.createFolder.mockRejectedValueOnce(
      new Error("POST /files/directories failed (400)"),
    );
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const execute = queueMutation.mock.calls[0]?.[0]?.execute as (
      signal: AbortSignal,
    ) => Promise<void>;
    await act(async () => {
      await execute(new AbortController().signal);
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/B.md",
        to: "B.md",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it("batch-stars all selected files via a single undoable toast", async () => {
    const operations = createMockOperations();
    const { result } = renderActions(operations);
    await waitFor(() => expect(operations.listStars).toHaveBeenCalled());

    act(() => result.current.batchStar(FILES.map((file) => file.id)));

    expect(result.current.starred["search:file:users/alice/A.md"]).toBe(true);
    expect(result.current.starred["search:file:users/alice/B.md"]).toBe(true);
    expect(queueMutation).toHaveBeenCalledTimes(1);
    expect(queueMutation.mock.calls[0]?.[0]).toMatchObject({
      key: "docs:batch-star:search:file:users/alice/A.md,search:file:users/alice/B.md",
      toastMessage: "Starred",
      undoToastMessage: "Star changes undone.",
    });
    expect(operations.setStar).not.toHaveBeenCalled();

    const execute = queueMutation.mock.calls[0]?.[0]?.execute as (
      signal: AbortSignal,
    ) => Promise<void>;
    await act(async () => {
      await execute(new AbortController().signal);
    });
    expect(operations.setStar).toHaveBeenCalledTimes(2);
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/A.md", starred: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(operations.setStar).toHaveBeenCalledWith(
      { path: "/users/alice/B.md", starred: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("moves all selected files and refreshes once", async () => {
    const operations = createMockOperations();
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.requestMoveSelected(FILES.map((file) => file.id)));
    act(() => result.current.confirmMove("My Drive/Projects"));

    await waitFor(() => expect(operations.renameItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("trashes all selected files via one queued mutation", async () => {
    const operations = createMockOperations();
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.requestDeleteSelected(FILES.map((file) => file.id)));
    act(() => result.current.confirmTrash());

    expect(queueMutation).toHaveBeenCalledTimes(1);
    const execute = queueMutation.mock.calls[0]?.[0]?.execute as (
      signal: AbortSignal,
    ) => Promise<void>;
    await act(async () => {
      await execute(new AbortController().signal);
    });

    expect(operations.renameItem).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalled();
  });

  it("undo while online restores local offline caches captured before trash", async () => {
    const operations = createMockOperations();
    const data = {} as DriveUIData;
    operations.renameItem.mockResolvedValueOnce(data).mockResolvedValueOnce(data);
    const reload = vi.fn();
    const onAvailabilityChanged = vi.fn();
    const { result } = renderActions(operations, reload, {
      offlineUsername: "alice",
      onAvailabilityChanged,
    });

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });

    expect(captureOfflineDocsTrashSnapshot).toHaveBeenCalledWith("alice", "/users/alice/B.md");

    act(() => {
      queued?.undo();
    });
    await waitFor(() => expect(undoOfflineDocsTrash).toHaveBeenCalled());

    expect(undoOfflineDocsTrash).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({ apiPath: "/users/alice/B.md" }),
    );
    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenCalledWith({
        destination: "/users/alice",
        from: "/users/alice/.Trash/B.md",
        to: "B.md",
      }),
    );
    expect(reload).toHaveBeenCalled();
    expect(onAvailabilityChanged).toHaveBeenCalled();
  });

  it("undo while online reverts from actual trash path, not original api path", async () => {
    const operations = createMockOperations();
    const data = {} as DriveUIData;
    operations.renameItem.mockResolvedValueOnce(data).mockResolvedValueOnce(data);
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });

    act(() => {
      queued?.undo();
    });

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenLastCalledWith({
        destination: "/users/alice",
        from: "/users/alice/.Trash/B.md",
        to: "B.md",
      }),
    );
    expect(reload).toHaveBeenCalled();
  });

  it("undo uses unique trash path when a same-named file already exists in Trash", async () => {
    const operations = createMockOperations();
    operations.listAllDirectoryEntries = vi.fn(async (directory: string) => {
      if (directory === "/users/alice/.Trash") return [listedFile("/users/alice/.Trash/B.md")];
      return [];
    });
    const data = {} as DriveUIData;
    operations.renameItem.mockResolvedValueOnce(data).mockResolvedValueOnce(data);
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });

    expect(operations.renameItem).toHaveBeenCalledWith(
      {
        destination: "/users/alice/.Trash",
        from: "/users/alice/B.md",
        to: "B 2.md",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    act(() => {
      queued?.undo();
    });

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenLastCalledWith({
        destination: "/users/alice",
        from: "/users/alice/.Trash/B 2.md",
        to: "B.md",
      }),
    );
  });

  it("undo restores files already moved to Trash when a later rename throws", async () => {
    const operations = createMockOperations();
    const data = {} as DriveUIData;
    operations.renameItem
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error("rename failed"));
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.requestDeleteSelected(FILES.map((entry) => entry.id)));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await expect(queued?.execute(new AbortController().signal)).rejects.toThrow("rename failed");
    });

    await act(async () => {
      queued?.onError?.();
    });

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenCalledWith({
        destination: "/users/alice",
        from: "/users/alice/.Trash/A.md",
        to: "A.md",
      }),
    );
    const restores = () =>
      operations.renameItem.mock.calls.filter((call) => call[0].destination === "/users/alice");
    expect(restores()).toEqual([
      [{ destination: "/users/alice", from: "/users/alice/.Trash/A.md", to: "A.md" }],
    ]);

    await act(async () => {
      queued?.undo();
    });
    expect(restores()).toEqual([
      [{ destination: "/users/alice", from: "/users/alice/.Trash/A.md", to: "A.md" }],
    ]);
    expect(reload).toHaveBeenCalled();
  });

  it("undo restores offline caches only for files that reached Trash", async () => {
    const operations = createMockOperations();
    const data = {} as DriveUIData;
    operations.renameItem
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error("rename failed"));
    const { result } = renderActions(operations, vi.fn(), { offlineUsername: "alice" });

    act(() => result.current.requestDeleteSelected(FILES.map((entry) => entry.id)));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await expect(queued?.execute(new AbortController().signal)).rejects.toThrow("rename failed");
    });
    await act(async () => {
      queued?.undo();
    });

    await waitFor(() => expect(undoOfflineDocsTrash).toHaveBeenCalledTimes(1));
    expect(undoOfflineDocsTrash).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({ apiPath: "/users/alice/A.md" }),
    );
  });

  it("restores a trashed file under a free name when the original title is taken", async () => {
    const operations = createMockOperations();
    operations.listAllDirectoryEntries.mockImplementation(async (directory: string) => {
      if (directory === "/users/alice") return [listedFile("/users/alice/B.md")];
      return [];
    });
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });
    await act(async () => {
      queued?.undo();
    });

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenLastCalledWith({
        destination: "/users/alice",
        from: "/users/alice/.Trash/B.md",
        to: "B 2.md",
      }),
    );
    expect(showToast).toHaveBeenCalledWith("Restored “B.md” as “B 2.md”");
    expect(reload).toHaveBeenCalled();
  });

  it("writes offline caches at the free name after a taken title is restored", async () => {
    const operations = createMockOperations();
    operations.listAllDirectoryEntries.mockImplementation(async (directory: string) => {
      if (directory === "/users/alice") return [listedFile("/users/alice/B.md")];
      return [];
    });
    const { result } = renderActions(operations, vi.fn(), { offlineUsername: "alice" });

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });
    await act(async () => {
      queued?.undo();
    });

    await waitFor(() =>
      expect(undoOfflineDocsTrash).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          apiPath: "/users/alice/B 2.md",
          listingResult: expect.objectContaining({
            sourceKey: "users/alice/B 2.md",
            title: "B 2.md",
          }),
          availability: expect.objectContaining({ id: "users/alice/B 2.md" }),
        }),
      ),
    );
    expect(removeOutboxMutationsForDocsPath).toHaveBeenCalledWith("alice", "/users/alice/B.md");
    const outboxOrder = vi.mocked(removeOutboxMutationsForDocsPath).mock.invocationCallOrder[0];
    const cacheOrder = vi.mocked(undoOfflineDocsTrash).mock.invocationCallOrder[0];
    expect(outboxOrder).toBeLessThan(cacheOrder);
  });

  it("undoes a still-queued trash locally when the browser is online again", async () => {
    vi.mocked(removeOutboxMutationsForDocsPath).mockResolvedValueOnce(true);
    const operations = createMockOperations();
    const { result } = renderActions(operations, vi.fn(), { offlineUsername: "alice" });

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });

    await act(async () => {
      queued?.undo();
    });

    await waitFor(() =>
      expect(undoOfflineDocsTrash).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({ apiPath: "/users/alice/B.md" }),
      ),
    );
    const restores = operations.renameItem.mock.calls.filter(
      (call) => call[0].from.includes("/.Trash/") && call[0].destination === "/users/alice",
    );
    expect(restores).toEqual([]);
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  it("does not restore offline caches for a file whose server restore failed", async () => {
    const operations = createMockOperations();
    const data = {} as DriveUIData;
    operations.listAllDirectoryEntries.mockImplementation(async (directory: string) => {
      if (directory === "/users/alice") return [listedFile("/users/alice/B.md")];
      return [];
    });
    operations.renameItem.mockImplementation(
      async (input: { destination: string; from: string }) => {
        if (input.destination.endsWith("/.Trash")) return data;
        if (input.from.endsWith("/.Trash/A.md")) throw new Error("restore failed");
        return data;
      },
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderActions(operations, vi.fn(), { offlineUsername: "alice" });

    act(() => result.current.requestDeleteSelected(FILES.map((entry) => entry.id)));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });
    await act(async () => {
      queued?.undo();
    });

    await waitFor(() => expect(undoOfflineDocsTrash).toHaveBeenCalledTimes(1));
    expect(undoOfflineDocsTrash).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({ apiPath: "/users/alice/B 2.md" }),
    );
    expect(undoOfflineDocsTrash).not.toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({ apiPath: "/users/alice/A.md" }),
    );
    consoleError.mockRestore();
  });

  it("reports several renamed restores in one toast", async () => {
    const operations = createMockOperations();
    operations.listAllDirectoryEntries.mockImplementation(async (directory: string) => {
      if (directory === "/users/alice") {
        return [listedFile("/users/alice/A.md"), listedFile("/users/alice/B.md")];
      }
      return [];
    });
    const { result } = renderActions(operations);

    act(() => result.current.requestDeleteSelected(FILES.map((entry) => entry.id)));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });
    await act(async () => {
      queued?.undo();
    });

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith("Restored 2 files under a new name");
  });

  it("keeps later restores when one fails, reports the failure, and reloads", async () => {
    const operations = createMockOperations();
    const data = {} as DriveUIData;
    operations.listAllDirectoryEntries.mockImplementation(async (directory: string) => {
      if (directory === "/users/alice") return [listedFile("/users/alice/B.md")];
      return [];
    });
    operations.renameItem.mockImplementation(
      async (input: { destination: string; from: string }) => {
        if (input.destination.endsWith("/.Trash")) return data;
        if (input.from.endsWith("/.Trash/A.md")) throw new Error("restore failed");
        return data;
      },
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    const { result } = renderActions(operations, reload);

    act(() => result.current.requestDeleteSelected(FILES.map((entry) => entry.id)));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });
    const reloadsBeforeUndo = reload.mock.calls.length;

    await act(async () => {
      queued?.undo();
    });

    await waitFor(() =>
      expect(operations.renameItem).toHaveBeenLastCalledWith({
        destination: "/users/alice",
        from: "/users/alice/.Trash/B.md",
        to: "B 2.md",
      }),
    );
    expect(showToast).toHaveBeenCalledWith("Restored “B.md” as “B 2.md”");
    expect(showErrorToast).toHaveBeenCalledWith("Couldn't restore 1 file");
    expect(reload.mock.calls.length).toBeGreaterThan(reloadsBeforeUndo);
    consoleError.mockRestore();
  });

  it("skips server revert on undo when offline-only trash never reached the server", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createMockOperations();
    const reload = vi.fn();
    const onAvailabilityChanged = vi.fn();
    const { result } = renderActions(operations, reload, {
      offlineUsername: "alice",
      onAvailabilityChanged,
    });

    act(() => result.current.onTrash(FILES[1]!));
    act(() => result.current.confirmTrash());

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });

    const trashCalls = operations.renameItem.mock.calls.length;

    act(() => {
      queued?.undo();
    });
    await waitFor(() => expect(undoOfflineDocsTrash).toHaveBeenCalled());

    expect(operations.renameItem).toHaveBeenCalledTimes(trashCalls);
    expect(onAvailabilityChanged).toHaveBeenCalled();
  });

  it("permanently deletes files when confirming from the Trash view", async () => {
    const operations = createMockOperations();
    const reload = vi.fn();
    const trashFiles = [
      file({
        id: "search:file:users/alice/.Trash/B.md",
        title: "B.md",
        apiPath: "/users/alice/.Trash/B.md",
        parent: "Trash",
      }),
    ];
    const { result } = renderActions(operations, reload, {
      inTrashView: true,
      files: trashFiles,
    });

    act(() => result.current.onTrash(trashFiles[0]!));
    expect(result.current.deleteState).toEqual({
      ids: ["search:file:users/alice/.Trash/B.md"],
      permanent: true,
    });

    act(() => result.current.confirmTrash());

    expect(queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "docs:delete:search:file:users/alice/.Trash/B.md",
        toastMessage: "Deleted “B.md”",
        executeImmediately: true,
      }),
    );

    const queued = queueMutation.mock.calls[0]?.[0];
    await act(async () => {
      await queued?.execute(new AbortController().signal);
    });

    expect(operations.deleteItems).toHaveBeenCalledWith(
      ["/users/alice/.Trash/B.md"],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(operations.renameItem).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });
});
