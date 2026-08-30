import { afterEach, describe, expect, it, vi } from "vitest";

import { runViewTransition, VIEW_TRANSITION_ROOT_CLASS } from "./view-transition";

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
    })),
  );
}

afterEach(() => {
  document.documentElement.classList.remove(VIEW_TRANSITION_ROOT_CLASS);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runViewTransition", () => {
  it("applies the update immediately when startViewTransition is missing", () => {
    stubReducedMotion(false);
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    });
    const update = vi.fn();

    runViewTransition(update);

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains(VIEW_TRANSITION_ROOT_CLASS)).toBe(false);
  });

  it("skips View Transitions when prefers-reduced-motion is set", () => {
    stubReducedMotion(true);
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const update = vi.fn();

    runViewTransition(update);

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("runs the update inside startViewTransition and clears the root class", async () => {
    stubReducedMotion(false);
    let settle!: () => void;
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const update = vi.fn();

    runViewTransition(update);

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains(VIEW_TRANSITION_ROOT_CLASS)).toBe(true);

    settle();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.classList.contains(VIEW_TRANSITION_ROOT_CLASS)).toBe(false);
  });

  it("awaits a promise returned from the update before finishing", async () => {
    stubReducedMotion(false);
    let released = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startViewTransition = vi.fn(async (callback: () => void | Promise<void>) => {
      await callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    runViewTransition(() => pending);
    expect(released).toBe(false);
    released = true;
    release();
    await pending;
    expect(startViewTransition).toHaveBeenCalledOnce();
  });

  it("still applies the update when startViewTransition throws", () => {
    stubReducedMotion(false);
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: () => {
        throw new Error("busy");
      },
    });
    const update = vi.fn();

    runViewTransition(update);

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains(VIEW_TRANSITION_ROOT_CLASS)).toBe(false);
  });
});
