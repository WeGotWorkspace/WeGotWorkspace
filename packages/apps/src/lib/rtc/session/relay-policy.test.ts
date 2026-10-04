import { describe, expect, it } from "vitest";
import { needsRelayPrecheck, shouldRequestRelay } from "@/lib/rtc/session/relay-policy";

describe("shouldRequestRelay", () => {
  it("never asks when both sides are open", () => {
    expect(shouldRequestRelay("open", "open", true)).toBe(false);
    expect(shouldRequestRelay("open", "open", false)).toBe(false);
  });

  it("asks only the worse path, and the initiator on a non-open tie", () => {
    expect(shouldRequestRelay("udp-blocked", "open", false)).toBe(true);
    expect(shouldRequestRelay("open", "symmetric", true)).toBe(false);
    expect(shouldRequestRelay("symmetric", "symmetric", true)).toBe(true);
    expect(shouldRequestRelay("symmetric", "symmetric", false)).toBe(false);
    expect(shouldRequestRelay("unknown", undefined, true)).toBe(true);
  });
});

describe("needsRelayPrecheck", () => {
  it("is only symmetric or udp-blocked", () => {
    expect(needsRelayPrecheck("symmetric")).toBe(true);
    expect(needsRelayPrecheck("udp-blocked")).toBe(true);
    expect(needsRelayPrecheck("open")).toBe(false);
    expect(needsRelayPrecheck("unknown")).toBe(false);
    expect(needsRelayPrecheck(undefined)).toBe(false);
  });
});
