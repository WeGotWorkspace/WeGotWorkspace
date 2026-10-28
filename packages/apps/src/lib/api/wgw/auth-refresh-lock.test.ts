// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_REFRESH_WEB_LOCK_NAME,
  resetAuthRefreshLockForTests,
  withAuthRefreshLock,
} from "./auth-refresh-lock";
import {
  crossTabLockStorageKey,
  resetCrossTabLockForTests,
  withCrossTabLock,
} from "@/lib/cross-tab/cross-tab-lock";
import { driveUploaderLockName } from "@/lib/offline/drive/upload/drive-upload-lock-name";

const REFRESH_LOCK_KEY = crossTabLockStorageKey(AUTH_REFRESH_WEB_LOCK_NAME);

afterEach(() => {
  resetAuthRefreshLockForTests();
  resetCrossTabLockForTests();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "locks");
});

/** Minimal exclusive LockManager: one queue per name, like the browser's. */
function fakeLockManager(): LockManager {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: (name: string, _options: LockOptions, callback: () => Promise<unknown>) => {
      const previous = tails.get(name) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(callback);
      tails.set(
        name,
        next.catch(() => undefined),
      );
      return next;
    },
  } as unknown as LockManager;
}

function useWebLocks(locks: LockManager): void {
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
  resetCrossTabLockForTests();
}

describe("withAuthRefreshLock", () => {
  it("runs the refresh task under the Web Locks mutex when the browser provides one", async () => {
    const request = vi.fn(
      async (_name: string, _options: LockOptions, callback: () => Promise<boolean>) => callback(),
    );
    useWebLocks({ request } as unknown as LockManager);

    await expect(
      withAuthRefreshLock(async () => {
        return true;
      }),
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      "wgw-auth-refresh",
      { mode: "exclusive" },
      expect.any(Function),
    );
    expect(window.localStorage.getItem(REFRESH_LOCK_KEY)).toBeNull();
  });

  it("waits for another tab's refresh record and then runs the task itself", async () => {
    window.localStorage.setItem(
      REFRESH_LOCK_KEY,
      JSON.stringify({ owner: "other-tab", heartbeatAt: Date.now() }),
    );
    setTimeout(() => window.localStorage.removeItem(REFRESH_LOCK_KEY), 100);
    const task = vi.fn(async () => true);

    await expect(withAuthRefreshLock(task)).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("coalesces refresh calls inside one tab", async () => {
    const task = vi.fn(async () => true);
    const [a, b] = await Promise.all([withAuthRefreshLock(task), withAuthRefreshLock(task)]);
    expect(a && b).toBe(true);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("never shares its name with the Drive uploader", () => {
    expect(driveUploaderLockName("alice")).not.toBe(AUTH_REFRESH_WEB_LOCK_NAME);
    expect(driveUploaderLockName("alice")).toContain("alice");
  });

  it.each([
    ["Web Locks", () => useWebLocks(fakeLockManager())],
    ["the localStorage fallback", () => resetCrossTabLockForTests()],
  ])("lets a token refresh run while the uploader lock is held (%s)", async (_label, setup) => {
    setup();
    const refresh = vi.fn(async () => true);
    const uploadResult = await withCrossTabLock(driveUploaderLockName("alice"), async () => {
      // `wgwFetch` renews the token in the middle of an upload.
      const renewed = await withAuthRefreshLock(refresh);
      return { renewed };
    });
    expect(uploadResult).toEqual({ renewed: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
