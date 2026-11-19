/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("@/app-rail/src/last-app-location");
}

describe("last app location", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("returns nothing for an app the user has not visited", async () => {
    const { lastAppLocation } = await load();
    expect(lastAppLocation("notes")).toBeNull();
  });

  it("remembers the last path and search per app", async () => {
    const { lastAppLocation, rememberAppLocation } = await load();
    rememberAppLocation("notes", { pathname: "/notes/all/abc", search: {} });
    rememberAppLocation("docs", { pathname: "/docs", search: { id: "fn-1" } });
    rememberAppLocation("notes", { pathname: "/notes/starred", search: {} });
    expect(lastAppLocation("notes")).toEqual({ pathname: "/notes/starred", search: {} });
    expect(lastAppLocation("docs")).toEqual({ pathname: "/docs", search: { id: "fn-1" } });
  });

  it("survives a reload in the same tab", async () => {
    const first = await load();
    first.rememberAppLocation("calendar", { pathname: "/calendar/week/2026-11-18", search: {} });
    const second = await load();
    expect(second.lastAppLocation("calendar")).toEqual({
      pathname: "/calendar/week/2026-11-18",
      search: {},
    });
  });

  it("ignores a stored spot that belongs to another app", async () => {
    window.sessionStorage.setItem(
      "wgw.app-rail.last-locations",
      JSON.stringify({ notes: { pathname: "/admin/users", search: {} } }),
    );
    const { lastAppLocation } = await load();
    expect(lastAppLocation("notes")).toBeNull();
  });

  it("starts clean when the stored value is not JSON", async () => {
    window.sessionStorage.setItem("wgw.app-rail.last-locations", "{nope");
    const { lastAppLocation } = await load();
    expect(lastAppLocation("notes")).toBeNull();
  });
});
