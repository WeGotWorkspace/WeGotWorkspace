/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { isRtcDebugEnabled, setRtcDebugEnabled } from "@/lib/rtc/debug";
import { parseRtcSettingsPayload, resolveRtcSettings } from "@/lib/api/wgw/rtc";

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

  it("applies the server debug flag", () => {
    resolveRtcSettings({
      stunUrls: "",
      turnAvailable: false,
      forceRelay: false,
      debug: true,
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
