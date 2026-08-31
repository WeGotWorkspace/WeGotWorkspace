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
    resolveLive(live);

    await waitFor(() => expect(result.current.data).toEqual(live));
    expect(result.current.successVersion).toBe(versionAfterCache);
  });
});
