import { describe, expect, it, vi } from "vitest";
import {
  PrincipalLinkRegistry,
  getPrincipalLinkRegistry,
  resetPrincipalLinkRegistryForTests,
} from "@/lib/rtc/session/principal-link-registry";
import type { CollabReuseEnvelope } from "@/lib/rtc/session/collab-reuse-envelope";

function openEnvelope(room = "doc-a"): CollabReuseEnvelope {
  return { v: 1, kind: "collab-reuse", room, op: "open", collabPeerId: "aa" };
}

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
    expect(registry.sendToUsername("admin", openEnvelope())).toBe(2);
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

  it("notifies link subscribers when a live principal link disappears", () => {
    const registry = new PrincipalLinkRegistry();
    const seen: string[] = [];
    registry.subscribeLinks(() => seen.push("drop"));
    registry.registerLink({ username: "wouter", principalPeerId: "p1", send: vi.fn() });
    registry.unregisterLink("p1");
    registry.unregisterLink("missing");
    registry.registerLink({ username: "admin", principalPeerId: "p2", send: vi.fn() });
    registry.retain(new Set());
    expect(seen).toEqual(["drop", "drop"]);
  });

  it("notifies link-open subscribers when a principal DC registers", () => {
    const registry = new PrincipalLinkRegistry();
    const opened: string[] = [];
    registry.subscribeLinkOpen((username, peerId) => opened.push(`${username}:${peerId}`));
    registry.registerLink({ username: "wouter", principalPeerId: "p1", send: vi.fn() });
    registry.registerLink({ username: "wouter", principalPeerId: "p1", send: vi.fn() });
    expect(opened).toEqual(["wouter:p1"]);
  });

  it("tracks usernames whose principal mesh link is still connecting", () => {
    const registry = new PrincipalLinkRegistry();
    registry.setConnectingUsernames(new Set(["admin"]));
    expect(registry.isConnectingTo("admin")).toBe(true);
    expect(registry.isConnectingTo("wouter")).toBe(false);
    registry.setConnectingUsernames(new Set());
    expect(registry.isConnectingTo("admin")).toBe(false);
  });

  it("dispatches inbound envelopes to subscribers", () => {
    const registry = new PrincipalLinkRegistry();
    const seen: string[] = [];
    const unsubscribe = registry.subscribe((username, peerId, envelope) => {
      seen.push(`${username}:${peerId}:${envelope.op}`);
    });
    registry.receive("admin", "p1", openEnvelope());
    unsubscribe();
    registry.receive("admin", "p1", openEnvelope());
    expect(seen).toEqual(["admin:p1:open"]);
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
