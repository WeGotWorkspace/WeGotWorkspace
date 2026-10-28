import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import {
  FOLDER_LISTING_RETRY_DELAYS_MS,
  isRetryableListingError,
  useDriveFolderListingSync,
} from "@/drive-core/src/use-drive-folder-listing-sync";

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
  return { hook, showError, setFiles, setHydratedFolderPath };
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

    expect(hook.result.current.listingError).toEqual({
      path: FOLDER,
      message: "GET failed (429)",
    });
    expect(showError).not.toHaveBeenCalled();
    expect(changeDir).toHaveBeenCalledTimes(1);

    await advance(FOLDER_LISTING_RETRY_DELAYS_MS[0]);

    expect(changeDir).toHaveBeenCalledTimes(2);
    expect(hook.result.current.listingError).toBeNull();
  });

  it("does not retry a listing the server refused for good", async () => {
    const changeDir = vi.fn().mockRejectedValue(statusError(404));
    const { hook } = setup({ changeDir });
    await flush();

    expect(hook.result.current.listingError?.path).toBe(FOLDER);
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

    act(() => hook.result.current.retryListing());
    await flush();
    expect(changeDir).toHaveBeenCalledTimes(attempts + 1);
  });

  it("keeps cached rows on screen and only toasts when a listing fails", async () => {
    const changeDir = vi.fn().mockRejectedValue(statusError(429));
    const readCachedDirectory = vi.fn().mockResolvedValue(listing([ROW]));
    const { hook, showError } = setup({ changeDir, readCachedDirectory });
    await flush();
    await flush();

    expect(hook.result.current.listingError).toBeNull();
    expect(showError).toHaveBeenCalledTimes(1);
  });
});
