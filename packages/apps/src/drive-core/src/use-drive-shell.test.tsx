import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import type { ViewKey } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";
import { useDriveShell } from "@/drive-core/src/use-drive-shell";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

// Stable handlers, like the real hook: shell effects depend on `showError`.
const toast = vi.hoisted(() => ({
  show: () => {},
  showError: () => {},
  showSuccess: () => {},
  dismiss: () => {},
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toast,
}));

const USER = "alice";
const MY_DRIVE_CWD = `/users/${USER}`;
/** Drive opens on All Files; the upload tests list Personal itself. */
const MY_DRIVE_VIEW: ViewKey = { type: "folder", path: "My Drive" };

function directoryEntry(name: string) {
  return {
    name,
    path: `${MY_DRIVE_CWD}/${name}`,
    type: "file" as const,
    size: 100,
    time: 1,
    permissions: 644,
    myRights: fullDriveMyRights,
  };
}

function driveData(fileNames: string[]): DriveUIData {
  return {
    user: { username: USER, name: USER, role: "user", roots: ["/users"] },
    cwd: MY_DRIVE_CWD,
    directory: {
      location: MY_DRIVE_CWD,
      files: fileNames.map(directoryEntry),
    },
  };
}

const session: WorkspaceSession = {
  user: { displayName: USER, initials: "A", username: USER },
  viewerInboxLabel: USER,
};

function createOperations(changeDir: DriveAPIOperations["changeDir"]): DriveAPIOperations {
  return {
    refreshState: vi.fn(),
    changeDir,
    listDirectory: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn(),
    createFile: vi.fn(),
    renameItem: vi.fn(),
    deleteItems: vi.fn(),
    downloadFile: vi.fn(),
    readFileBlob: vi.fn(),
    checkUploadReady: vi.fn(),
    listStars: vi.fn().mockResolvedValue([]),
    listEntriesByPaths: vi.fn().mockResolvedValue([]),
    setStar: vi.fn(),
    uploadFiles: vi.fn(),
  };
}

const PROJECTS_CWD = `${MY_DRIVE_CWD}/Projects`;

function folderData(cwd: string, fileNames: string[]): DriveUIData {
  return {
    ...driveData([]),
    cwd,
    directory: {
      location: cwd,
      files: fileNames.map((name) => ({ ...directoryEntry(name), path: `${cwd}/${name}` })),
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useDriveShell server folders (guests and mocks, no local tree)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("refetches the folder after returning from Recent so uploaded files stay visible", async () => {
    const bootstrap = driveData(["old.txt"]);
    const refreshed = driveData(["old.txt", "uploaded.txt"]);
    const changeDir = vi.fn().mockResolvedValue(refreshed);
    const operations = createOperations(changeDir);

    const { result, unmount } = renderHook(() =>
      useDriveShell({
        data: bootstrap,
        session,
        operations,
      }),
    );

    await waitFor(() => {
      expect(result.current.viewState).toBeNull();
    });

    act(() => {
      result.current.setFiles([
        driveFileFromEntry(directoryEntry("old.txt"), USER),
        driveFileFromEntry(directoryEntry("uploaded.txt"), USER),
      ]);
    });

    expect(result.current.files.map((file) => file.title)).toEqual(["old.txt", "uploaded.txt"]);

    act(() => {
      result.current.selectView({ type: "recent" });
    });

    expect(result.current.view.type).toBe("recent");
    expect(result.current.files.map((file) => file.title)).toEqual(["old.txt", "uploaded.txt"]);

    changeDir.mockClear();

    act(() => {
      result.current.selectView({ type: "folder", path: "My Drive" });
    });

    await waitFor(() => {
      expect(changeDir).toHaveBeenCalled();
      expect(result.current.files.map((file) => file.title)).toEqual(["old.txt", "uploaded.txt"]);
    });

    unmount();
  });

  it("keeps a folder in the loading state until its listing arrives", async () => {
    const live = deferred<DriveUIData>();
    const changeDir = vi.fn().mockReturnValue(live.promise);
    const operations = createOperations(changeDir);
    const bootstrap = driveData(["old.txt"]);
    const { result } = renderHook(() => useDriveShell({ data: bootstrap, session, operations }));
    await waitFor(() => expect(result.current.viewState).toBeNull());

    act(() => {
      result.current.selectView({ type: "folder", path: "My Drive/Projects" });
    });

    await waitFor(() => expect(changeDir).toHaveBeenCalled());
    expect(result.current.viewState).toBe("first-sync");

    await act(async () => {
      live.resolve(folderData(PROJECTS_CWD, ["plan.md"]));
    });
    await waitFor(() => expect(result.current.viewState).toBeNull());
    expect(result.current.files.map((file) => file.title)).toEqual(["plan.md"]);
  });

  it("keeps a failed folder listing an error with Try again, never an empty folder", async () => {
    const changeDir = vi.fn().mockRejectedValueOnce(new Error("Server error"));
    const operations = createOperations(changeDir);
    const bootstrap = driveData(["old.txt"]);
    const { result } = renderHook(() => useDriveShell({ data: bootstrap, session, operations }));
    await waitFor(() => expect(result.current.viewState).toBeNull());

    act(() => {
      result.current.selectView({ type: "folder", path: "My Drive/Projects" });
    });
    await waitFor(() => expect(result.current.viewState).toBe("error"));

    changeDir.mockResolvedValueOnce(folderData(PROJECTS_CWD, ["plan.md"]));
    act(() => result.current.retryFolder());
    await waitFor(() => expect(result.current.viewState).toBeNull());
    expect(changeDir).toHaveBeenCalledTimes(2);
    expect(result.current.files.map((file) => file.title)).toEqual(["plan.md"]);
  });

  it("does not load starred paths for guest share sessions", async () => {
    const changeDir = vi.fn().mockResolvedValue(driveData(["inside.md"]));
    const listStars = vi.fn().mockRejectedValue(new Error("GET /files/starred failed (403)"));
    const operations = {
      ...createOperations(changeDir),
      listStars,
    };
    const guestData: DriveUIData = {
      ...driveData(["inside.md"]),
      user: {
        username: USER,
        name: "",
        role: "guest" as DriveUIData["user"]["role"],
        roots: ["/users"],
      },
    };

    const { unmount } = renderHook(() =>
      useDriveShell({
        data: guestData,
        session,
        operations,
        view: { type: "folder", path: "My Drive/Test" },
        onViewChange: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(changeDir).toHaveBeenCalled();
    });
    expect(listStars).not.toHaveBeenCalled();

    unmount();
  });
});

describe("useDriveShell upload placeholders", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("merges queued placeholders into the boot listing without a queue event", async () => {
    const placeholder = {
      ...directoryEntry("queued.txt"),
      path: `${MY_DRIVE_CWD}/\u0000upload:u1`,
      upload: { id: "u1", batchId: "b1", status: "queued" as const },
    };
    const operations: DriveAPIOperations = {
      ...createOperations(vi.fn()),
      readCachedDirectory: vi.fn().mockResolvedValue({
        ...driveData(["old.txt"]),
        directory: { location: MY_DRIVE_CWD, files: [directoryEntry("old.txt"), placeholder] },
      }),
      subscribeUploadQueue: () => () => {},
    };
    // Boot data from the cached bootstrap: the server listing, without placeholders.
    const bootstrap = driveData(["old.txt"]);
    const { result } = renderHook(() =>
      useDriveShell({ data: bootstrap, session, operations, view: MY_DRIVE_VIEW }),
    );

    await waitFor(() =>
      expect(result.current.files.map((file) => [file.title, file.upload?.status])).toEqual([
        ["old.txt", undefined],
        ["queued.txt", "queued"],
      ]),
    );
  });
});
