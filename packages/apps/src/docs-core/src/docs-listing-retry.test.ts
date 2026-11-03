import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const online = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => online.value,
}));

import { DOCS_LISTING_RETRY_DELAYS_MS, retryFailedListing } from "./docs-listing-retry";

describe("retryFailedListing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    online.value = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads after a failed load, waiting longer each time", () => {
    const failed = { current: 0 };
    const setReloadToken = vi.fn();
    retryFailedListing(failed, false, setReloadToken, new AbortController().signal);
    vi.advanceTimersByTime(DOCS_LISTING_RETRY_DELAYS_MS[0] - 1);
    expect(setReloadToken).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setReloadToken).toHaveBeenCalledTimes(1);

    retryFailedListing(failed, false, setReloadToken, new AbortController().signal);
    vi.advanceTimersByTime(DOCS_LISTING_RETRY_DELAYS_MS[1]);
    expect(setReloadToken).toHaveBeenCalledTimes(2);
    expect(failed.current).toBe(2);
  });

  it("resets the backoff once a load succeeds", () => {
    const failed = { current: 3 };
    const setReloadToken = vi.fn();
    retryFailedListing(failed, true, setReloadToken, new AbortController().signal);
    expect(failed.current).toBe(0);
    vi.runAllTimers();
    expect(setReloadToken).not.toHaveBeenCalled();
  });

  it("stops after the last delay", () => {
    const failed = { current: DOCS_LISTING_RETRY_DELAYS_MS.length };
    const setReloadToken = vi.fn();
    retryFailedListing(failed, false, setReloadToken, new AbortController().signal);
    vi.runAllTimers();
    expect(setReloadToken).not.toHaveBeenCalled();
  });

  it("does not schedule a reload while offline", () => {
    online.value = false;
    const setReloadToken = vi.fn();
    retryFailedListing({ current: 0 }, false, setReloadToken, new AbortController().signal);
    vi.runAllTimers();
    expect(setReloadToken).not.toHaveBeenCalled();
  });

  it("cancels the reload when the signal aborts", () => {
    const controller = new AbortController();
    const setReloadToken = vi.fn();
    retryFailedListing({ current: 0 }, false, setReloadToken, controller.signal);
    controller.abort();
    vi.runAllTimers();
    expect(setReloadToken).not.toHaveBeenCalled();
  });
});
