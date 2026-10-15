/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRtcDebugEnabled, setRtcDebugEnabled } from "@/lib/rtc/debug";
import { fetchRtcSettings, parseRtcSettingsPayload, resolveRtcSettings } from "@/lib/api/wgw/rtc";

describe("parseRtcSettingsPayload", () => {
  it("reads forceRelay and debug from the rtc block", () => {
    expect(
      parseRtcSettingsPayload({
        rtc: {
          stunUrls: "stun:example.test",
          turnAvailable: true,
          forceRelay: true,
          debug: true,
        },
      }),
    ).toEqual({
      stunUrls: "stun:example.test",
      turnAvailable: true,
      forceRelay: true,
      debug: true,
    });
  });

  it("defaults missing flags to false", () => {
    expect(parseRtcSettingsPayload({ rtc: { stunUrls: "" } })).toEqual({
      stunUrls: "",
      turnAvailable: false,
      forceRelay: false,
      debug: false,
    });
  });
});

describe("resolveRtcSettings", () => {
  afterEach(() => {
    setRtcDebugEnabled(false);
    delete (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__;
  });

  it("does not change the debug flag", () => {
    setRtcDebugEnabled(true);
    resolveRtcSettings({
      stunUrls: "",
      turnAvailable: false,
      forceRelay: false,
      debug: false,
    });
    expect(isRtcDebugEnabled()).toBe(true);
  });

  it("keeps forceRelay from the server", () => {
    expect(
      resolveRtcSettings({
        stunUrls: "",
        turnAvailable: true,
        forceRelay: true,
        debug: false,
      }).forceRelay,
    ).toBe(true);
  });
});

describe("fetchRtcSettings", () => {
  afterEach(() => {
    setRtcDebugEnabled(false);
    vi.unstubAllGlobals();
    delete (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__;
  });

  it("applies the server debug flag on a successful fetch", async () => {
    const body = JSON.stringify({
      rtc: {
        stunUrls: "",
        turnAvailable: false,
        forceRelay: false,
        debug: true,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => body,
      }),
    );
    const result = await fetchRtcSettings({ room: "bootstrap" });
    expect(isRtcDebugEnabled()).toBe(true);
    expect(result.source).toBe("server");
  });

  it("a failed configuration fetch keeps the debug flag", async () => {
    setRtcDebugEnabled(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }),
    );
    const result = await fetchRtcSettings({ room: "bootstrap" });
    expect(isRtcDebugEnabled()).toBe(true);
    expect(result.source).toBe("fallback");
    expect(result).toMatchObject({
      stunUrls: "",
      turnAvailable: false,
      forceRelay: false,
    });
  });

  it("sends Authorization when bearerToken is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchRtcSettings({ room: "bootstrap", bearerToken: "t" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rooms/bootstrap/configuration"),
      expect.objectContaining({
        headers: { Authorization: "Bearer t" },
      }),
    );
  });

  it("sends no Authorization header without a token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchRtcSettings({ room: "bootstrap" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rooms/bootstrap/configuration"),
      expect.objectContaining({
        headers: {},
      }),
    );
  });

  it("appends sessionKey to the URL without an Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchRtcSettings({ room: "bootstrap", sessionKey: "k" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/rooms\/bootstrap\/configuration\?sessionKey=k$/),
      expect.objectContaining({
        headers: {},
      }),
    );
  });
});
