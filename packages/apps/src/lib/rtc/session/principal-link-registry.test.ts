import { describe, expect, it, vi } from "vitest";
import {
  PrincipalLinkRegistry,
  getPrincipalLinkRegistry,
  resetPrincipalLinkRegistryForTests,
} from "@/lib/rtc/session/principal-link-registry";

describe("PrincipalLinkRegistry", () => {
  it("indexes open links by username and supports multi-tab fan-out", () => {
    const registry = new PrincipalLinkRegistry();
    const sendTab1 = vi.fn();
    const sendTab2 = vi.fn();
    const sendOther = vi.fn();
    registry.registerLink({ username: "admin", principalPeerId: "p1", send: sendTab1 });
    registry.registerLink({ username: "admin", principalPeerId: "p2", send: sendTab2 });
    registry.registerLink({ username: "wouter", principalPeerId: "p3", send: sendOther });

    expect(registry.hasOpenLink("admin")).toBe(true);
    expect(registry.hasOpenLink("carol")).toBe(false);
    expect(registry.sendToUsername("admin", { hello: 1 })).toBe(2);
    expect(sendTab1).toHaveBeenCalledTimes(1);
    expect(sendTab2).toHaveBeenCalledTimes(1);
    expect(sendOther).not.toHaveBeenCalled();
  });

  it("retains only live principal peer ids", () => {
    const registry = new PrincipalLinkRegistry();
    registry.registerLink({ username: "admin", principalPeerId: "p1", send: vi.fn() });
    registry.registerLink({ username: "wouter", principalPeerId: "p2", send: vi.fn() });
    registry.retain(new Set(["p2"]));
    expect(registry.hasOpenLink("admin")).toBe(false);
    expect(registry.hasOpenLink("wouter")).toBe(true);
  });

  it("tracks usernames whose principal mesh link is still connecting", () => {
    const registry = new PrincipalLinkRegistry();
    registry.setConnectingUsernames(new Set(["admin"]));
    expect(registry.isConnectingTo("admin")).toBe(true);
    expect(registry.isConnectingTo("wouter")).toBe(false);
    registry.setConnectingUsernames(new Set());
    expect(registry.isConnectingTo("admin")).toBe(false);
  });

  it("waits for principal join attempt and resolves immediately once marked", async () => {
    vi.useFakeTimers();
    const registry = new PrincipalLinkRegistry();
    const pending = registry.waitForPrincipalJoinAttempt(5000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    registry.markPrincipalJoinAttempted();
    await pending;
    expect(settled).toBe(true);
    vi.useRealTimers();
  });

  it("times out principal join wait when presence never joins", async () => {
    vi.useFakeTimers();
    const registry = new PrincipalLinkRegistry();
    const pending = registry.waitForPrincipalJoinAttempt(2000);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    vi.useRealTimers();
  });
});

describe("principal link registry singleton", () => {
  it("resets between tests", () => {
    getPrincipalLinkRegistry().registerLink({
      username: "admin",
      principalPeerId: "p1",
      send: vi.fn(),
    });
    expect(getPrincipalLinkRegistry().hasOpenLink("admin")).toBe(true);
    resetPrincipalLinkRegistryForTests();
    expect(getPrincipalLinkRegistry().hasOpenLink("admin")).toBe(false);
  });
});
