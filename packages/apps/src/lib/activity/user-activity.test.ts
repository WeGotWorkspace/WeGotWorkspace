/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installUserActivity,
  onUserResumed,
  resetUserActivityForTests,
  USER_IDLE_AFTER_MS,
  userIsIdle,
} from "./user-activity";

describe("user activity (#2294)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    resetUserActivityForTests(Date.now());
    installUserActivity();
  });

  afterEach(() => {
    resetUserActivityForTests();
    vi.useRealTimers();
  });

  it("turns idle after two minutes without input and active on the next key", () => {
    expect(userIsIdle()).toBe(false);
    vi.advanceTimersByTime(USER_IDLE_AFTER_MS);
    expect(userIsIdle()).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown"));
    expect(userIsIdle()).toBe(false);
  });

  it("counts input in another tab through the shared time", () => {
    vi.advanceTimersByTime(USER_IDLE_AFTER_MS);
    expect(userIsIdle()).toBe(true);

    localStorage.setItem("wgw.activity.lastInputAt", String(Date.now()));
    expect(userIsIdle()).toBe(false);
  });

  it("tells listeners once when the user comes back from idle", () => {
    const resumed = vi.fn();
    onUserResumed(resumed);

    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(resumed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(USER_IDLE_AFTER_MS);
    window.dispatchEvent(new PointerEvent("pointerdown"));
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(resumed).toHaveBeenCalledTimes(1);
  });
});
