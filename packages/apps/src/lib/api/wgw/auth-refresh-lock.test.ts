// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAuthRefreshLockForTests, withAuthRefreshLock } from "./auth-refresh-lock";

const REFRESH_LOCK_KEY = "wgw.api.refresh.lock";

afterEach(() => {
  resetAuthRefreshLockForTests();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "locks");
});

describe("withAuthRefreshLock", () => {
  it("runs the refresh task under the Web Locks mutex when the browser provides one", async () => {
    const request = vi.fn(
      async (_name: string, _options: LockOptions, callback: () => Promise<boolean>) => callback(),
    );
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

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
});
