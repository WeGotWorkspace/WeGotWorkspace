/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRtcDebugOverrides, isRtcForceRelayEnabled } from "@/lib/rtc/force-relay";
import { initialIceMode } from "@/lib/rtc/session/mesh-peer-dialer";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";

describe("initialIceMode", () => {
  it("starts on relay only when force-relay and TURN are both on", () => {
    expect(initialIceMode({ forceRelay: true, turnAvailable: true })).toBe("relay");
    expect(initialIceMode({ forceRelay: true, turnAvailable: false })).toBe("direct");
    expect(initialIceMode({ forceRelay: false, turnAvailable: true })).toBe("direct");
  });
});

describe("isRtcForceRelayEnabled", () => {
  afterEach(() => {
    delete (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__;
    vi.unstubAllEnvs();
  });

  it("is off by default", () => {
    expect(isRtcForceRelayEnabled()).toBe(false);
  });

  it("turns on from a test override", () => {
    (
      window as Window & { __WGW_RTC_TEST_OVERRIDES__?: { debug: boolean; forceRelay: boolean } }
    ).__WGW_RTC_TEST_OVERRIDES__ = { debug: false, forceRelay: true };
    expect(isRtcForceRelayEnabled()).toBe(true);
  });
});

describe("applyRtcDebugOverrides", () => {
  afterEach(() => {
    delete (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__;
    vi.unstubAllEnvs();
  });

  it("defaults forceRelay to false without debug flags", () => {
    expect(
      applyRtcDebugOverrides({
        ...DEFAULT_RTC_SETTINGS,
        forceRelay: false,
      }).forceRelay,
    ).toBe(false);
  });

  it("keeps a server forceRelay of true", () => {
    expect(
      applyRtcDebugOverrides({
        ...DEFAULT_RTC_SETTINGS,
        forceRelay: true,
      }).forceRelay,
    ).toBe(true);
  });

  it("turns on forceRelay from a test override", () => {
    (
      window as Window & { __WGW_RTC_TEST_OVERRIDES__?: { debug: boolean; forceRelay: boolean } }
    ).__WGW_RTC_TEST_OVERRIDES__ = { debug: false, forceRelay: true };
    expect(
      applyRtcDebugOverrides({
        ...DEFAULT_RTC_SETTINGS,
        forceRelay: false,
      }).forceRelay,
    ).toBe(true);
  });
});
