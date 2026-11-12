import { describe, expect, it } from "vitest";
import { isLazyAssetRequest, isShellPrecacheEntry, shellAssetUrls } from "./precache-shell";

const HTML = `<script type="module" crossorigin src="/assets/index-AAA.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-BBB.js">
<link rel="stylesheet" crossorigin href="/assets/index-CCC.css">`;

describe("precache shell", () => {
  const shell = shellAssetUrls(HTML);

  it("reads the entry script, modulepreload and stylesheet from index.html", () => {
    expect([...shell].sort()).toEqual([
      "assets/index-AAA.js",
      "assets/index-CCC.css",
      "assets/vendor-BBB.js",
    ]);
  });

  it("keeps the shell and non-script assets, drops lazy chunks", () => {
    expect(isShellPrecacheEntry("assets/index-AAA.js", shell)).toBe(true);
    expect(isShellPrecacheEntry("assets/vendor-BBB.js", shell)).toBe(true);
    expect(isShellPrecacheEntry("index.html", shell)).toBe(true);
    expect(isShellPrecacheEntry("assets/font-DDD.woff2", shell)).toBe(true);
    expect(isShellPrecacheEntry("assets/contacts-app-EEE.js", shell)).toBe(false);
    expect(isShellPrecacheEntry("assets/contacts-app-EEE.css", shell)).toBe(false);
  });

  it("matches only same-origin hashed assets for the runtime cache", () => {
    const origin = "https://wgw.test";
    expect(isLazyAssetRequest(new URL("/assets/contacts-app-EEE.js", origin), origin)).toBe(true);
    expect(isLazyAssetRequest(new URL("/assets/x.png", origin), origin)).toBe(false);
    expect(isLazyAssetRequest(new URL("/assets/x.js", "https://cdn.test"), origin)).toBe(false);
    expect(isLazyAssetRequest(new URL("/api/v1/x.js", origin), origin)).toBe(false);
  });
});
