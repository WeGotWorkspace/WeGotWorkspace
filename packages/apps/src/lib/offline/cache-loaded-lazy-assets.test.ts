import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheLoadedLazyAssets, LAZY_ASSET_CACHE } from "./cache-loaded-lazy-assets";

describe("cacheLoadedLazyAssets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the hashed assets the page loaded, and nothing else", async () => {
    const put = vi.fn(async () => {});
    const open = vi.fn(async () => ({ match: async () => undefined, put }));
    vi.stubGlobal("caches", { open });
    vi.stubGlobal("PerformanceObserver", undefined);
    const fetchMock = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", fetchMock);
    const origin = "https://app.test";
    vi.stubGlobal("location", { origin, href: `${origin}/contacts/all` });
    vi.stubGlobal("performance", {
      getEntriesByType: () => [
        { name: `${origin}/assets/contacts-app-AAA.js` },
        { name: `${origin}/assets/contacts-app-AAA.css` },
        { name: `${origin}/api/v1/me` },
        { name: "https://cdn.example/assets/x-BBB.js" },
      ],
    });

    cacheLoadedLazyAssets();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2));

    expect(open).toHaveBeenCalledWith(LAZY_ASSET_CACHE);
    expect(fetchMock).toHaveBeenCalledWith(`${origin}/assets/contacts-app-AAA.js`, {
      cache: "force-cache",
    });
  });
});
