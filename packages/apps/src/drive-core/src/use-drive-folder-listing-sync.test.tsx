import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/lib/files/drive-types";
import {
  FOLDER_LISTING_RETRY_DELAYS_MS,
  isRetryableListingError,
  useDriveFolderListingSync,
} from "@/drive-core/src/use-drive-folder-listing-sync";
import { driveFileFromEntry } from "@/drive-core/src/drive-file-utils";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";

const driveOutboxHasPending = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/drive/drive-file-node-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/drive/drive-file-node-push")>()),
  driveOutboxHasPending,
}));

const USER = "alice";
const FOLDER = "My Drive/Projects";

function listing(files: DriveUIData["directory"]["files"] = []): DriveUIData {
  return {
    user: { username: USER, name: USER, role: "user", roots: ["/users"] },
    cwd: "/users/alice/Projects",
    directory: { location: "/users/alice/Projects", files },
  };
}

const ROW = {
  name: "plan.md",
  path: "/users/alice/Projects/plan.md",
  type: "file",
  size: 10,
  time: 1,
} as DriveUIData["directory"]["files"][number];

function statusError(status: number): Error {
  return Object.assign(new Error(`GET failed (${status})`), { status });
}

function setup(operations: Partial<DriveAPIOperations>) {
  const showError = vi.fn();
  const setFiles = vi.fn();
  const setHydratedFolderPath = vi.fn();
  const commitView = vi.fn();
  // Stable identities, as the shell's refs are: new ones would restart the load.
  const groupRootNamesRef = { current: new Set<string>() };
  const syncedFolderPathRef = { current: null as string | null };
  const pendingFolderRefetchRef = { current: true };
  const hook = renderHook(() =>
    useDriveFolderListingSync({
      operations: operations as DriveAPIOperations,
      folderViewPath: FOLDER,
      listLoading: false,
      currentUsername: USER,
      groupRootNamesRef,
      syncedFolderPathRef,
      pendingFolderRefetchRef,
      setFiles: setFiles as (update: React.SetStateAction<DriveFile[]>) => void,
      setHydratedFolderPath,
      commitView,
      showError,
    }),
  );
  return { hook, showError, setFiles, setHydratedFolderPath, syncedFolderPathRef };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const flush = () => advance(0);

describe("isRetryableListingError", () => {
  it("retries rate limits, server errors and network failures only", () => {
    expect(isRetryableListingError(statusError(429))).toBe(true);
    expect(isRetryableListingError(statusError(503))).toBe(true);
    expect(isRetryableListingError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableListingError(statusError(404))).toBe(false);
    expect(isRetryableListingError(statusError(403))).toBe(false);
    expect(isRetryableListingError(new Error("This folder is not available offline."))).toBe(false);
  });
});

describe("useDriveFolderListingSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a 429 listing as an error, not an empty folder, and retries it", async () => {
    const changeDir = vi
      .fn()
      .mockRejectedValueOnce(statusError(429))
      .mockResolvedValueOnce(listing([ROW]));
    const { hook, showError } = setup({ changeDir });
    await flush();

    expect(hook.result.current.folderListingError).toEqual({
      path: FOLDER,
      message: "GET failed (429)",
    });
    expect(showError).toHaveBeenCalledTimes(1);
    expect(changeDir).toHaveBeenCalledTimes(1);

    await advance(FOLDER_LISTING_RETRY_DELAYS_MS[0]);

    expect(changeDir).toHaveBeenCalledTimes(2);
    expect(hook.result.current.folderListingError).toBeNull();
  });

  it("does not retry a listing the server refused for good", async () => {
    const changeDir = vi.fn().mockRejectedValue(statusError(404));
    const { hook } = setup({ changeDir });
    await flush();

    expect(hook.result.current.folderListingError?.path).toBe(FOLDER);
    await advance(60_000);
    expect(changeDir).toHaveBeenCalledTimes(1);
  });

  it("stops retrying on its own after the last delay, and Try again starts over", async () => {
    const changeDir = vi.fn().mockRejectedValue(statusError(429));
    const { hook } = setup({ changeDir });
    await flush();
    for (const delay of FOLDER_LISTING_RETRY_DELAYS_MS) {
      await advance(delay);
    }
    const attempts = FOLDER_LISTING_RETRY_DELAYS_MS.length + 1;
    expect(changeDir).toHaveBeenCalledTimes(attempts);
    await advance(120_000);
    expect(changeDir).toHaveBeenCalledTimes(attempts);

    act(() => hook.result.current.retryFolderListing());
    await flush();
    expect(changeDir).toHaveBeenCalledTimes(attempts + 1);
  });

  it("toasts once per failure streak, not on every automatic retry", async () => {
    const changeDir = vi.fn().mockRejectedValue(statusError(429));
    const readCachedDirectory = vi.fn().mockResolvedValue(listing([ROW]));
    const { showError, setFiles } = setup({ changeDir, readCachedDirectory });
    await flush();
    await flush();
    await advance(FOLDER_LISTING_RETRY_DELAYS_MS[0]);
    await advance(FOLDER_LISTING_RETRY_DELAYS_MS[1]);

    expect(changeDir).toHaveBeenCalledTimes(3);
    expect(setFiles).toHaveBeenCalled();
    expect(showError).toHaveBeenCalledTimes(1);
  });

  it("paints cached rows that arrive after the live listing failed, and clears the error", async () => {
    const changeDir = vi.fn().mockRejectedValue(statusError(429));
    let resolveCache: (value: DriveUIData) => void = () => undefined;
    const readCachedDirectory = vi.fn(
      () => new Promise<DriveUIData>((resolve) => (resolveCache = resolve)),
    );
    const { hook, setFiles } = setup({ changeDir, readCachedDirectory });
    await flush();
    expect(hook.result.current.folderListingError?.path).toBe(FOLDER);

    resolveCache(listing([ROW]));
    await flush();

    expect(setFiles).toHaveBeenCalled();
    expect(hook.result.current.folderListingError).toBeNull();
  });
});

describe("useDriveFolderListingSync on another user's change (#1663)", () => {
  const OPTIMISTIC: DriveFile = {
    ...driveFileFromEntry(ROW, USER),
    id: "f-1",
    title: "New folder",
    apiPath: undefined,
  };
  const QUEUED = driveFileFromEntry(
    { ...ROW, name: "queued.md", path: "/users/alice/Projects/queued.md" },
    USER,
  );

  beforeEach(() => {
    vi.useFakeTimers();
    driveOutboxHasPending.mockReset();
    driveOutboxHasPending.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function loaded(changeDir: DriveAPIOperations["changeDir"]) {
    const ctx = setup({ changeDir });
    await flush();
    ctx.setFiles.mockClear();
    ctx.setHydratedFolderPath.mockClear();
    return ctx;
  }

  function lastUpdate(setFiles: ReturnType<typeof vi.fn>) {
    const update = setFiles.mock.calls.at(-1)?.[0] as (previous: DriveFile[]) => DriveFile[];
    return update;
  }

  it("loads the open folder again in place and drops rows the server removed", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    const { setFiles, setHydratedFolderPath } = await loaded(changeDir);

    changeDir.mockResolvedValue(listing([]));
    act(() => notifyDriveRemoteChange(USER));
    await flush();

    expect(changeDir).toHaveBeenCalledTimes(2);
    // No pending state: the rows stay on screen while the folder loads again.
    expect(setHydratedFolderPath).not.toHaveBeenCalled();
    const next = lastUpdate(setFiles)([driveFileFromEntry(ROW, USER), OPTIMISTIC]);
    expect(next.map((file) => file.id)).toEqual(["f-1"]);
  });

  it("keeps rows of writes that wait in the outbox", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    const { setFiles } = await loaded(changeDir);
    driveOutboxHasPending.mockResolvedValue(true);

    act(() => notifyDriveRemoteChange(USER));
    await flush();

    const next = lastUpdate(setFiles)([QUEUED]);
    expect(next.map((file) => file.title)).toEqual(["plan.md", "queued.md"]);
  });

  it("collapses changes during a load into one more load", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    await loaded(changeDir);
    let release: (value: DriveUIData) => void = () => undefined;
    changeDir.mockImplementationOnce(
      () => new Promise<DriveUIData>((resolve) => (release = resolve)),
    );

    act(() => {
      notifyDriveRemoteChange(USER);
      notifyDriveRemoteChange(USER);
      notifyDriveRemoteChange(USER);
    });
    await flush();
    expect(changeDir).toHaveBeenCalledTimes(2);

    release(listing([ROW]));
    await flush();
    expect(changeDir).toHaveBeenCalledTimes(3);
  });

  it("leaves a folder that is still loading to that load", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    const { syncedFolderPathRef } = await loaded(changeDir);
    syncedFolderPathRef.current = null;

    act(() => notifyDriveRemoteChange(USER));
    await flush();

    expect(changeDir).toHaveBeenCalledTimes(1);
  });

  it("retries a failed refresh of the open folder, and not a refused one", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    await loaded(changeDir);
    changeDir.mockRejectedValueOnce(statusError(503)).mockResolvedValueOnce(listing([ROW]));

    act(() => notifyDriveRemoteChange(USER));
    await flush();
    expect(changeDir).toHaveBeenCalledTimes(2);
    await advance(FOLDER_LISTING_RETRY_DELAYS_MS[0]);
    expect(changeDir).toHaveBeenCalledTimes(3);

    changeDir.mockRejectedValue(statusError(404));
    act(() => notifyDriveRemoteChange(USER));
    await flush();
    await advance(60_000);
    expect(changeDir).toHaveBeenCalledTimes(4);
  });

  it("backs off a failing refresh through the delay list, then stops", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    await loaded(changeDir);
    changeDir.mockRejectedValue(statusError(503));

    act(() => notifyDriveRemoteChange(USER));
    await flush();
    let calls = 2;
    expect(changeDir).toHaveBeenCalledTimes(calls);
    for (const delay of FOLDER_LISTING_RETRY_DELAYS_MS) {
      await advance(delay - 1);
      expect(changeDir).toHaveBeenCalledTimes(calls);
      await advance(1);
      calls += 1;
      expect(changeDir).toHaveBeenCalledTimes(calls);
    }
    await advance(120_000);
    expect(changeDir).toHaveBeenCalledTimes(calls);
  });

  it("ignores another account's changes", async () => {
    const changeDir = vi.fn<DriveAPIOperations["changeDir"]>().mockResolvedValue(listing([ROW]));
    await loaded(changeDir);

    act(() => notifyDriveRemoteChange("bob"));
    await flush();

    expect(changeDir).toHaveBeenCalledTimes(1);
  });
});
