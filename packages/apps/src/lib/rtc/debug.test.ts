/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { isRtcDebugEnabled, setRtcDebugEnabled } from "@/lib/rtc/debug";

describe("isRtcDebugEnabled", () => {
  afterEach(() => {
    setRtcDebugEnabled(false);
    delete (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__;
  });

  it("is off by default", () => {
    expect(isRtcDebugEnabled()).toBe(false);
  });

  it("turns on from the server flag", () => {
    setRtcDebugEnabled(true);
    expect(isRtcDebugEnabled()).toBe(true);
  });

  it("turns on from a test override", () => {
    (
      window as Window & { __WGW_RTC_TEST_OVERRIDES__?: { debug: boolean; forceRelay: boolean } }
    ).__WGW_RTC_TEST_OVERRIDES__ = { debug: true, forceRelay: false };
    expect(isRtcDebugEnabled()).toBe(true);
  });
});
