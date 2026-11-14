import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfflineNotCachedError } from "./offline-not-cached-error";
import { useHybridBootstrap } from "./use-hybrid-bootstrap";

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => true,
}));

describe("useHybridBootstrap", () => {
  it("keeps the thrown error so the shell can tell its cause (#2100)", async () => {
    const thrown = new OfflineNotCachedError("notes");
    const load = () => Promise.reject(thrown);
    const readCache = () => Promise.resolve(null);

    const { result } = renderHook(() => useHybridBootstrap({ load, readCache }));

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe(thrown);
  });

  it("wraps a thrown non-Error in an Error", async () => {
    const load = () => Promise.reject("boom");
    const readCache = () => Promise.resolve(null);

    const { result } = renderHook(() => useHybridBootstrap({ load, readCache }));

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error?.message).toBe("boom");
  });

  it("does not bump successVersion when live follow-up replaces cache", async () => {
    const cached = { from: "cache" };
    const live = { from: "live" };
    let resolveLive!: (value: typeof live) => void;
    const livePromise = new Promise<typeof live>((resolve) => {
      resolveLive = resolve;
    });
    const load = () => livePromise;
    const readCache = () => Promise.resolve(cached);

    const { result } = renderHook(() => useHybridBootstrap({ load, readCache }));

    await waitFor(() => expect(result.current.data).toEqual(cached));
    const versionAfterCache = result.current.successVersion;
    expect(result.current.complete).toBe(true);
    resolveLive(live);

    await waitFor(() => expect(result.current.data).toEqual(live));
    expect(result.current.successVersion).toBe(versionAfterCache);
    expect(result.current.complete).toBe(true);
  });

  it("paints the first progress chunk before the load settles", async () => {
    const first = { from: "page-1" };
    const done = { from: "done" };
    let report!: (partial: typeof first) => void;
    let resolveLive!: (value: typeof done) => void;
    const load = (onProgress?: (partial: typeof first) => void) => {
      report = onProgress!;
      return new Promise<typeof done>((resolve) => {
        resolveLive = resolve;
      });
    };
    const readCache = () => Promise.resolve(null);

    const { result } = renderHook(() => useHybridBootstrap({ load, readCache }));

    await waitFor(() => expect(report).toEqual(expect.any(Function)));
    report(first);

    await waitFor(() => expect(result.current.data).toEqual(first));
    const versionAfterFirstPage = result.current.successVersion;
    expect(result.current.phase).toBe("ready");
    expect(result.current.complete).toBe(false);

    report({ from: "page-2" });
    await waitFor(() => expect(result.current.data).toEqual({ from: "page-2" }));
    expect(result.current.complete).toBe(false);
    expect(result.current.phase).toBe("ready");

    resolveLive(done);
    await waitFor(() => expect(result.current.data).toEqual(done));
    expect(result.current.successVersion).toBe(versionAfterFirstPage);
    expect(result.current.complete).toBe(true);
  });

  it("loads live data when readCache never settles", async () => {
    const live = { from: "live" };
    const load = vi.fn(() => Promise.resolve(live));
    const readCache = () => new Promise<typeof live | null>(() => undefined);

    const { result } = renderHook(() =>
      useHybridBootstrap({ load, readCache, cacheTimeoutMs: 10 }),
    );

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.data).toEqual(live);
    expect(result.current.complete).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads live data when readCache rejects", async () => {
    const live = { from: "live" };
    const load = vi.fn(() => Promise.resolve(live));
    const readCache = () => Promise.reject<typeof live | null>(new Error("idb blocked"));

    const { result } = renderHook(() => useHybridBootstrap({ load, readCache }));

    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.data).toEqual(live);
    expect(result.current.complete).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
