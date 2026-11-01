import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  estimateFreeDeviceBytes,
  isQuotaExceededError,
  LOCAL_COPY_HEADROOM_BYTES,
  planLocalCopies,
  requestPersistentStorageOnce,
  resetPersistentStorageRequestForTests,
} from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { stubNavigatorStorage } from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const MB = 1024 * 1024;

describe("device storage checks", () => {
  let restore: () => void = () => undefined;

  beforeEach(() => {
    resetPersistentStorageRequestForTests();
  });

  afterEach(() => {
    restore();
    restore = () => undefined;
  });

  it("treats space as sufficient when navigator.storage is missing (insecure context)", async () => {
    restore = stubNavigatorStorage(undefined);
    expect(await estimateFreeDeviceBytes()).toBeNull();
    expect(await planLocalCopies([10 * 1024 * MB])).toEqual([true]);
  });

  it("treats space as sufficient when estimate() is missing", async () => {
    restore = stubNavigatorStorage({ persist: async () => true });
    expect(await planLocalCopies([5 * MB])).toEqual([true]);
  });

  it("treats space as sufficient when estimate() fails", async () => {
    restore = stubNavigatorStorage({
      estimate: async () => {
        throw new Error("blocked");
      },
    });
    expect(await planLocalCopies([5 * MB])).toEqual([true]);
  });

  it("stores files locally while they fit and sends the rest directly", async () => {
    const free = 3 * LOCAL_COPY_HEADROOM_BYTES;
    restore = stubNavigatorStorage({
      estimate: async () => ({ quota: free + 10 * MB, usage: 10 * MB }),
    });
    const fits = LOCAL_COPY_HEADROOM_BYTES;
    expect(await planLocalCopies([fits, fits, fits])).toEqual([true, true, false]);
  });

  it("calls persist() only once per tab", async () => {
    const persist = vi.fn(async () => true);
    restore = stubNavigatorStorage({ persist, estimate: async () => ({ quota: 1, usage: 0 }) });
    await requestPersistentStorageOnce();
    await requestPersistentStorageOnce();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("skips a missing persist() where estimate() exists (Safari) without a TypeError", async () => {
    restore = stubNavigatorStorage({ estimate: async () => ({ quota: 1, usage: 0 }) });
    await expect(requestPersistentStorageOnce()).resolves.toBeUndefined();
  });

  it("skips persist() when navigator.storage is missing", async () => {
    restore = stubNavigatorStorage(undefined);
    await expect(requestPersistentStorageOnce()).resolves.toBeUndefined();
  });

  it("recognises quota errors directly and wrapped by Dexie", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(isQuotaExceededError(quota)).toBe(true);
    expect(isQuotaExceededError({ name: "AbortError", inner: quota })).toBe(true);
    expect(isQuotaExceededError(new Error("other"))).toBe(false);
  });
});
