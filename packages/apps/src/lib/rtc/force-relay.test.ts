import { describe, expect, it } from "vitest";
import {
  applyRtcDebugOverrides,
  isRtcForceRelayEnabledFromQuery,
  parseRtcForceRelayFlag,
} from "@/lib/rtc/force-relay";
import { initialIceMode } from "@/lib/rtc/session/mesh-peer-dialer";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";

describe("isRtcForceRelayEnabledFromQuery", () => {
  it("matches rtcForceRelay=1", () => {
    expect(isRtcForceRelayEnabledFromQuery("?rtcForceRelay=1")).toBe(true);
    expect(isRtcForceRelayEnabledFromQuery("?rtcForceRelay=true")).toBe(true);
    expect(isRtcForceRelayEnabledFromQuery("?rtcDebug=1")).toBe(false);
    expect(isRtcForceRelayEnabledFromQuery("?rtcForceRelay=public")).toBe(false);
    expect(isRtcForceRelayEnabledFromQuery("?iceTransportPolicy=relay")).toBe(false);
  });
});

describe("parseRtcForceRelayFlag", () => {
  it("keeps the debug flag as the number 1 and ignores public", () => {
    expect(parseRtcForceRelayFlag(1)).toBe(1);
    expect(parseRtcForceRelayFlag("true")).toBe(1);
    expect(parseRtcForceRelayFlag("public")).toBeUndefined();
    expect(parseRtcForceRelayFlag("relay")).toBeUndefined();
  });
});

describe("initialIceMode", () => {
  it("starts on relay only when force-relay and TURN are both on", () => {
    expect(initialIceMode({ forceRelay: true, turnAvailable: true })).toBe("relay");
    expect(initialIceMode({ forceRelay: true, turnAvailable: false })).toBe("direct");
    expect(initialIceMode({ forceRelay: false, turnAvailable: true })).toBe("direct");
  });
});

describe("applyRtcDebugOverrides", () => {
  it("defaults forceRelay to false without debug flags", () => {
    expect(
      applyRtcDebugOverrides({
        ...DEFAULT_RTC_SETTINGS,
        forceRelay: false,
      }).forceRelay,
    ).toBe(false);
  });
});
