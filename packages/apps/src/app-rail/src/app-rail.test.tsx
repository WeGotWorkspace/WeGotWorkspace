/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let location = { pathname: "/notes/all/abc", search: {} as Record<string, unknown> };

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location }),
}));

vi.mock("@/app-switch-button/src/use-show-admin-app", () => ({
  useShowAdminApp: () => true,
}));

import { AppRail } from "@/app-rail/src/app-rail";
import { clearLastAppLocations, rememberAppLocation } from "@/app-rail/src/last-app-location";

function tile(name: string | RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

describe("AppRail", () => {
  beforeEach(() => {
    navigate.mockReset();
    clearLastAppLocations();
    location = { pathname: "/notes/all/abc", search: {} };
  });

  afterEach(() => {
    cleanup();
  });

  it("lists the apps, then Settings before Admin, and marks the current app", () => {
    render(<AppRail />);
    const names = screen.getAllByRole("link").map((link) => link.getAttribute("aria-label"));
    expect(names.slice(-2)).toEqual(["Open Settings", "Open Admin"]);
    expect(names).toContain("Open Calendar");
    expect(tile("Open Notes").getAttribute("aria-current")).toBe("page");
    expect(tile("Open Calendar").getAttribute("aria-current")).toBeNull();
  });

  it("names a tile with unread notifications and shows its dot", () => {
    render(<AppRail unreadAppIds={new Set(["calendar"] as const)} />);
    const calendar = tile("Open Calendar, new notifications");
    expect(calendar.querySelector(".app-rail__dot")).not.toBeNull();
    expect(tile("Open Tasks").querySelector(".app-rail__dot")).toBeNull();
  });

  it("opens an app at its start screen the first time", () => {
    render(<AppRail />);
    fireEvent.click(tile("Open Calendar"));
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/calendar" });
  });

  it("returns to the remembered spot with a plain navigation, never a view transition", () => {
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    rememberAppLocation("docs", { pathname: "/docs", search: { id: "fn-1" } });
    render(<AppRail />);
    fireEvent.click(tile("Open Docs"));
    // No `viewTransition` option and no transition of its own: the route has to
    // commit even while another view transition is running.
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/docs", search: { id: "fn-1" } });
    expect(startViewTransition).not.toHaveBeenCalled();
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("remembers where the user is in the current app, and sends its own tile to the start screen", () => {
    const { unmount } = render(<AppRail />);
    fireEvent.click(tile("Open Notes"));
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/notes" });
    unmount();

    // From another app, Notes comes back at the note that was open.
    navigate.mockReset();
    location = { pathname: "/calendar/month/2026-11-19", search: {} };
    render(<AppRail />);
    fireEvent.click(tile("Open Notes"));
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/notes/all/abc", search: {} });
  });

  it("leaves a modified click to the browser (new tab)", () => {
    render(<AppRail />);
    const calendar = tile("Open Calendar");
    expect(calendar.getAttribute("href")).toBe("/calendar");
    fireEvent.click(calendar, { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
  });
});
