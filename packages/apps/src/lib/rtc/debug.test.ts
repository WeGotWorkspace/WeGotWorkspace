import { describe, expect, it } from "vitest";
import { isRtcDebugEnabledFromQuery, parseRtcDebugFlag } from "@/lib/rtc/debug";

describe("isRtcDebugEnabledFromQuery", () => {
  it("enables on rtcDebug=1 or true, with or without a leading ?", () => {
    expect(isRtcDebugEnabledFromQuery("?rtcDebug=1")).toBe(true);
    expect(isRtcDebugEnabledFromQuery("rtcDebug=1")).toBe(true);
    expect(isRtcDebugEnabledFromQuery("?file=groups%2Fteam-notes.md&rtcDebug=1")).toBe(true);
    expect(isRtcDebugEnabledFromQuery("?rtcDebug=true")).toBe(true);
    expect(isRtcDebugEnabledFromQuery("?rtcDebug")).toBe(true);
    expect(isRtcDebugEnabledFromQuery('?rtcDebug="1"')).toBe(true);
  });

  it("stays off when the param is absent or not truthy", () => {
    expect(isRtcDebugEnabledFromQuery("?file=groups%2Fteam-notes.md")).toBe(false);
    expect(isRtcDebugEnabledFromQuery("?rtcDebug=0")).toBe(false);
    expect(isRtcDebugEnabledFromQuery("")).toBe(false);
  });

  it("accepts legacy aliases", () => {
    expect(isRtcDebugEnabledFromQuery("?collabRtcDebug=1")).toBe(true);
    expect(isRtcDebugEnabledFromQuery("?meetRtcDebug=1")).toBe(true);
    expect(isRtcDebugEnabledFromQuery("?debugRtc=1")).toBe(true);
  });
});

describe("parseRtcDebugFlag", () => {
  it("keeps the declared search value as '1'", () => {
    expect(parseRtcDebugFlag("1")).toBe(1);
    expect(parseRtcDebugFlag(1)).toBe(1);
    expect(parseRtcDebugFlag(true)).toBe(1);
    expect(parseRtcDebugFlag("true")).toBe(1);
    expect(parseRtcDebugFlag('"1"')).toBe(1);
    expect(parseRtcDebugFlag("0")).toBeUndefined();
    expect(parseRtcDebugFlag(undefined)).toBeUndefined();
  });
});
