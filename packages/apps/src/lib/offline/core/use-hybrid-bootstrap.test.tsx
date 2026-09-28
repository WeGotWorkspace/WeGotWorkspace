import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHybridBootstrap } from "./use-hybrid-bootstrap";

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => true,
}));

describe("useHybridBootstrap", () => {
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
});
