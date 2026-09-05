import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRtcBrowserId } from "@/lib/rtc/signaling/browser-id";

function installMemoryStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

describe("readRtcBrowserId", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("mints a 32-hex id and reuses it on the next read", () => {
    const first = readRtcBrowserId();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(readRtcBrowserId()).toBe(first);
  });

  it("replaces a corrupt stored value", () => {
    localStorage.setItem("wgw.rtc.browserId", "not-valid");
    const next = readRtcBrowserId();
    expect(next).toMatch(/^[a-f0-9]{32}$/);
    expect(next).not.toBe("not-valid");
  });
});
