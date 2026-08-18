import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { useDriveShell } from "@/drive-core/src/use-drive-shell";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const USER = "alice";
const MY_DRIVE_CWD = `/users/${USER}`;

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
    plugins: [],
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

describe("useDriveShell folder listing sync", () => {
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
      expect(result.current.folderListingPending).toBe(false);
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

  it("loads Shared with me entries when the shared view is selected", async () => {
    const changeDir = vi.fn().mockResolvedValue(driveData(["old.txt"]));
    const listEntriesByPaths = vi.fn().mockResolvedValue([]);
    const operations = {
      ...createOperations(changeDir),
      listEntriesByPaths,
    };
    const listSharedWithMe = vi.fn().mockResolvedValue([
      {
        share: {
          id: "share-1",
          path: "/users/bob/Client Deck",
          kind: "member",
          defaultAccess: "edit",
          publicToken: null,
          hasPassword: false,
          expiresAt: null,
          updatedAt: null,
          shareWith: null,
          myRights: fullDriveMyRights,
        },
        entry: {
          name: "Client Deck",
          path: "/users/bob/Client Deck",
          type: "dir" as const,
          size: 0,
          time: 1,
          permissions: 755,
          myRights: fullDriveMyRights,
        },
      },
    ]);

    const { result, unmount } = renderHook(() =>
      useDriveShell({
        data: driveData(["old.txt"]),
        session,
        operations,
        shareOperations: {
          listSharedWithMe,
        } as never,
        view: { type: "shared" },
        onViewChange: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(listSharedWithMe).toHaveBeenCalled();
      expect(listEntriesByPaths).not.toHaveBeenCalled();
      expect(result.current.sharedItems?.map((file) => file.title)).toEqual(["Client Deck"]);
      expect(result.current.sharedItems?.[0]?.parent).toBe("Shared with me");
      expect(result.current.sharedItems?.[0]?.kind).toBe("folder");
    });

    unmount();
  });

  it("shows a single-file member share without parent listing", async () => {
    const listSharedWithMe = vi.fn().mockResolvedValue([
      {
        share: {
          id: "share-file",
          path: "/users/admin/Jaap.md",
          kind: "member",
          defaultAccess: "view",
          publicToken: null,
          hasPassword: false,
          expiresAt: null,
          updatedAt: "2026-08-05T10:00:00.000Z",
          shareWith: null,
          myRights: fullDriveMyRights,
        },
        entry: {
          name: "Jaap.md",
          path: "/users/admin/Jaap.md",
          type: "file" as const,
          size: 42,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
    ]);

    const { result, unmount } = renderHook(() =>
      useDriveShell({
        data: driveData(["old.txt"]),
        session,
        shareOperations: {
          listSharedWithMe,
        } as never,
        view: { type: "shared" },
        onViewChange: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.sharedItems?.map((file) => file.title)).toEqual(["Jaap.md"]);
      expect(result.current.sharedItems?.[0]?.apiPath).toBe("/users/admin/Jaap.md");
      expect(result.current.sharedItems?.[0]?.parent).toBe("Shared with me");
    });

    unmount();
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
