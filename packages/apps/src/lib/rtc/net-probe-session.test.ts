import { afterEach, describe, expect, it, vi } from "vitest";
import { getNetClass, peekNetClass } from "@/lib/rtc/net-probe";
import { netClassForJoin, stunUrlsForProbe } from "@/lib/rtc/net-probe-session";
import type { RtcSettings } from "@/lib/rtc/types";

vi.mock("@/lib/rtc/net-probe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rtc/net-probe")>();
  return { ...actual, getNetClass: vi.fn(async () => "open"), peekNetClass: vi.fn(() => null) };
});

function settings(stunUrls: string): RtcSettings {
  return { stunUrls, turnAvailable: false, forceRelay: false };
}

afterEach(() => {
  vi.mocked(getNetClass).mockClear();
});

describe("stunUrlsForProbe", () => {
  it("uses the configured list when it names two hosts", () => {
    const urls = ["stun:a.test:3478", "stun:b.test:3478"];
    expect(stunUrlsForProbe(urls)).toEqual(urls);
  });

  it("never falls back to servers the admin did not configure", () => {
    expect(stunUrlsForProbe([])).toEqual([]);
    expect(stunUrlsForProbe(["stun:stun.nextcloud.com:443", "stun:STUN.nextcloud.com"])).toEqual(
      [],
    );
  });
});

describe("netClassForJoin", () => {
  it("skips the probe without two STUN hosts", async () => {
    await expect(netClassForJoin(settings("stun:stun.nextcloud.com:443"))).resolves.toBe("unknown");
    expect(getNetClass).not.toHaveBeenCalled();
  });

  it("probes the configured hosts", async () => {
    await expect(netClassForJoin(settings("stun:a.test, stun:b.test"))).resolves.toBe("open");
    expect(getNetClass).toHaveBeenCalledWith({ stunUrls: ["stun:a.test", "stun:b.test"] });
  });

  it("reuses a cached class", async () => {
    vi.mocked(peekNetClass).mockReturnValueOnce("symmetric");
    await expect(netClassForJoin(settings(""))).resolves.toBe("symmetric");
    expect(getNetClass).not.toHaveBeenCalled();
  });
});
