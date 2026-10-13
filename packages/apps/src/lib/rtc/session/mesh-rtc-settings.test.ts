/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { MeshRtcSettings } from "@/lib/rtc/session/mesh-rtc-settings";
import type { RtcSettings } from "@/lib/rtc/types";

const initial: RtcSettings = {
  stunUrls: "stun:initial.example:3478",
  turnAvailable: false,
  forceRelay: false,
};

function holder(overrides?: Partial<ConstructorParameters<typeof MeshRtcSettings>[0]>) {
  const log = vi.fn();
  const onApplied = vi.fn();
  const settings = new MeshRtcSettings({
    channel: "meet",
    initial,
    log,
    onApplied,
    ...overrides,
  });
  return { settings, log, onApplied };
}

describe("MeshRtcSettings", () => {
  afterEach(() => {
    delete (window as Window & { __WGW_RTC_TEST_OVERRIDES__?: unknown }).__WGW_RTC_TEST_OVERRIDES__;
  });

  it("returns the initial settings with meet force-relay overrides applied", () => {
    (
      window as Window & { __WGW_RTC_TEST_OVERRIDES__?: { debug: boolean; forceRelay: boolean } }
    ).__WGW_RTC_TEST_OVERRIDES__ = { debug: false, forceRelay: true };
    const { settings } = holder();
    expect(settings.current()).toEqual(applyRtcDebugOverrides(initial));
    expect(settings.current().forceRelay).toBe(true);
  });

  it("apply is a no-op when stun, turn and force-relay are unchanged", () => {
    const { settings, onApplied } = holder();
    expect(settings.apply({ ...initial })).toBe(false);
    expect(settings.current()).toEqual(applyRtcDebugOverrides(initial));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("apply swaps current settings when stun, turn or force-relay differs", () => {
    const stun = holder();
    expect(stun.settings.apply({ ...initial, stunUrls: "stun:next.example:3478" })).toBe(true);
    expect(stun.settings.current().stunUrls).toBe("stun:next.example:3478");
    expect(stun.onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ stunUrls: "stun:next.example:3478" }),
    );

    const turn = holder();
    expect(turn.settings.apply({ ...initial, turnAvailable: true })).toBe(true);
    expect(turn.settings.current().turnAvailable).toBe(true);
    expect(turn.onApplied).toHaveBeenCalledTimes(1);

    const relay = holder();
    expect(relay.settings.apply({ ...initial, forceRelay: true })).toBe(true);
    expect(relay.settings.current().forceRelay).toBe(true);
    expect(relay.onApplied).toHaveBeenCalledTimes(1);
  });

  it("refreshes once per session key and again for a different key", async () => {
    const refresh = vi.fn(async () => ({ ...initial, turnAvailable: true }));
    const { settings } = holder({ refresh });
    await settings.adoptSessionKey("k");
    await settings.adoptSessionKey("k");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ sessionKey: "k" });
    await settings.adoptSessionKey("k2");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith({ sessionKey: "k2" });
    expect(settings.current().turnAvailable).toBe(true);
  });

  it("keeps the current settings and logs when refresh rejects", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("configuration down");
    });
    const { settings, log, onApplied } = holder({ refresh });
    await settings.adoptSessionKey("k");
    expect(settings.current()).toEqual(applyRtcDebugOverrides(initial));
    expect(onApplied).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("rtc-settings-refresh-failed", {
      error: expect.any(Error),
    });
  });

  it("leaves settings unchanged when refresh resolves null", async () => {
    const refresh = vi.fn(async () => null);
    const { settings, onApplied } = holder({ refresh });
    await settings.adoptSessionKey("k");
    expect(settings.current()).toEqual(applyRtcDebugOverrides(initial));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("does nothing on adopt when no refresh port is wired", async () => {
    const { settings, log, onApplied } = holder();
    await settings.adoptSessionKey("k");
    expect(settings.current()).toEqual(applyRtcDebugOverrides(initial));
    expect(log).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });
});
