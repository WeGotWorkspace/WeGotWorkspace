import { describe, expect, it, vi } from "vitest";
import { PrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import { TeamPrincipalLinks } from "@/presence-core/src/team-principal-links";

const link = (username: string, principalPeerId: string) => ({
  username,
  principalPeerId,
  send: vi.fn(),
});

describe("TeamPrincipalLinks", () => {
  it("registers one room's links per user, the first room by name", () => {
    const registry = new PrincipalLinkRegistry();
    const links = new TeamPrincipalLinks(registry);
    const sales = links.sinkFor("groups.sales");
    const design = links.sinkFor("groups.design");

    sales.registerLink(link("bob", "bob-sales"));
    sales.registerLink(link("carol", "carol-sales"));
    design.registerLink(link("bob", "bob-design"));

    expect(registry.linksForUsername("bob").map((l) => l.principalPeerId)).toEqual(["bob-design"]);
    expect(registry.linksForUsername("carol").map((l) => l.principalPeerId)).toEqual([
      "carol-sales",
    ]);
  });

  it("keeps both tabs of a user from the chosen room", () => {
    const registry = new PrincipalLinkRegistry();
    const design = new TeamPrincipalLinks(registry).sinkFor("groups.design");

    design.registerLink(link("bob", "bob-tab1"));
    design.registerLink(link("bob", "bob-tab2"));

    expect(registry.linksForUsername("bob")).toHaveLength(2);
  });

  it("falls back to the other room when the chosen room loses the link", () => {
    const registry = new PrincipalLinkRegistry();
    const links = new TeamPrincipalLinks(registry);
    const sales = links.sinkFor("groups.sales");
    const design = links.sinkFor("groups.design");
    sales.registerLink(link("bob", "bob-sales"));
    design.registerLink(link("bob", "bob-design"));

    design.retain(new Set());
    expect(registry.linksForUsername("bob").map((l) => l.principalPeerId)).toEqual(["bob-sales"]);

    links.removeRoom("groups.sales");
    expect(registry.hasOpenLink("bob")).toBe(false);
  });

  it("a room's retain drops only that room's links", () => {
    const registry = new PrincipalLinkRegistry();
    const links = new TeamPrincipalLinks(registry);
    links.sinkFor("groups.design").registerLink(link("bob", "bob-design"));
    links.sinkFor("groups.sales").registerLink(link("carol", "carol-sales"));

    links.sinkFor("groups.sales").retain(new Set());

    expect(registry.hasOpenLink("bob")).toBe(true);
    expect(registry.hasOpenLink("carol")).toBe(false);
  });

  it("reports a user as connecting only while no room has a link to them", () => {
    const registry = new PrincipalLinkRegistry();
    const links = new TeamPrincipalLinks(registry);
    links.sinkFor("groups.sales").setConnectingUsernames(new Set(["bob", "carol"]));
    links.sinkFor("groups.design").registerLink(link("bob", "bob-design"));

    expect(registry.isConnectingTo("bob")).toBe(false);
    expect(registry.isConnectingTo("carol")).toBe(true);
  });

  it("polls every joined room when a collab room asks for a principal poll", () => {
    const registry = new PrincipalLinkRegistry();
    const links = new TeamPrincipalLinks(registry);
    const design = vi.fn();
    const sales = vi.fn();
    links.sinkFor("groups.design").setPrincipalPoller(design);
    links.sinkFor("groups.sales").setPrincipalPoller(sales);

    expect(registry.requestPrincipalPoll("bob", 0)).toBe(true);
    expect(design).toHaveBeenCalledTimes(1);
    expect(sales).toHaveBeenCalledTimes(1);

    links.sinkFor("groups.design").setPrincipalPoller(null);
    links.removeRoom("groups.sales");
    expect(registry.requestPrincipalPoll("carol", 0)).toBe(false);
  });
});
