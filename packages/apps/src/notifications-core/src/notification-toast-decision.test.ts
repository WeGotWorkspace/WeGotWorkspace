import { describe, expect, it } from "vitest";
import { createIdListStore } from "./id-list-store";
import {
  pickRowsToToast,
  routeShowsNavigate,
  TOAST_DECIDED_STORAGE_KEY,
  type ToastDecisionDeps,
} from "./notification-toast-decision";
import type { NotificationInboxItem } from "./notifications-types";

function row(id: string, navigate: string): NotificationInboxItem {
  return {
    id,
    domain: "chat",
    action: "message_posted",
    title: "New message",
    body: null,
    navigate,
    tag: null,
    readAt: null,
    createdAt: "2026-11-04T10:00:00Z",
  };
}

/** One localStorage shared by the tabs of a fake browser. */
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function tab(
  storage: ReturnType<typeof memoryStorage>,
  front: Awaited<ReturnType<ToastDecisionDeps["frontTab"]>>,
  currentRoute = "/drive",
): ToastDecisionDeps {
  return {
    frontTab: async () => front,
    decided: createIdListStore(storage, TOAST_DECIDED_STORAGE_KEY, 500),
    currentRoute: () => currentRoute,
  };
}

const dm = row("n1", "/meet/dms/admin");

describe("routeShowsNavigate", () => {
  it("matches the same screen", () => {
    expect(routeShowsNavigate("/meet/dms/admin", "/meet/dms/admin")).toBe(true);
    expect(routeShowsNavigate("/meet/dms/Admin/", "/meet/dms/admin")).toBe(true);
    expect(routeShowsNavigate("/calendar", "/calendar")).toBe(true);
  });

  it("needs every query parameter of navigate, and allows more on the route", () => {
    expect(routeShowsNavigate("/docs?file=Plans%2Fq4.md", "/docs?file=Plans%2Fq4.md")).toBe(true);
    expect(
      routeShowsNavigate("/docs?file=Plans%2Fq4.md&thread=t1", "/docs?file=Plans%2Fq4.md"),
    ).toBe(true);
    expect(
      routeShowsNavigate(
        "/docs?file=Agenda%20Anne%20%26%20Co.md",
        "/docs?file=Agenda%20Anne%20%26%20Co.md",
      ),
    ).toBe(true);
    expect(routeShowsNavigate("/docs?file=A%23b.md", "/docs?file=A%23b.md")).toBe(true);
    expect(
      routeShowsNavigate("/docs?file=Agenda.md", "/docs?file=Agenda%20Anne%20%26%20Co.md"),
    ).toBe(false);
    expect(routeShowsNavigate("/docs?file=Other.md", "/docs?file=Plans%2Fq4.md")).toBe(false);
    expect(routeShowsNavigate("/docs", "/docs?file=Plans%2Fq4.md")).toBe(false);
  });

  it("does not match another screen of the same app, or the suite root", () => {
    expect(routeShowsNavigate("/meet/dms/bob", "/meet/dms/admin")).toBe(false);
    expect(routeShowsNavigate("/meet", "/meet/dms/admin")).toBe(false);
    expect(routeShowsNavigate("/calendar/week", "/calendar")).toBe(false);
    expect(routeShowsNavigate("/", "/")).toBe(false);
  });
});

describe("pickRowsToToast", () => {
  it("toasts in the front tab only", async () => {
    const storage = memoryStorage();
    const front = tab(storage, { self: true, route: "/drive" });
    const back = tab(storage, { self: false, route: "/drive" });
    expect(await pickRowsToToast([dm], back)).toEqual([]);
    expect(await pickRowsToToast([dm], front)).toEqual([dm]);
  });

  it("toasts a row once per browser, also when the front tab changes", async () => {
    const storage = memoryStorage();
    expect(await pickRowsToToast([dm], tab(storage, { self: true, route: null }))).toEqual([dm]);
    // The user switched tabs; the new front tab fetches the same row later.
    expect(await pickRowsToToast([dm], tab(storage, { self: true, route: null }))).toEqual([]);
  });

  it("shows nothing when every tab is hidden, and not later either", async () => {
    const storage = memoryStorage();
    expect(await pickRowsToToast([dm], tab(storage, null))).toEqual([]);
    expect(await pickRowsToToast([dm], tab(storage, { self: true, route: null }))).toEqual([]);
  });

  it("skips a row whose navigate is the screen the front tab shows", async () => {
    const storage = memoryStorage();
    const other = row("n2", "/calendar");
    const onDm = tab(storage, { self: true, route: "/meet/dms/admin" });
    expect(await pickRowsToToast([dm, other], onDm)).toEqual([other]);
  });

  it("uses this tab's own route when the hub has none yet", async () => {
    const storage = memoryStorage();
    const onDm = tab(storage, { self: true, route: null }, "/meet/dms/admin");
    expect(await pickRowsToToast([dm], onDm)).toEqual([]);
  });

  it("ignores rows that are already read", async () => {
    const storage = memoryStorage();
    const read = { ...dm, readAt: "2026-11-04T10:01:00Z" };
    expect(await pickRowsToToast([read], tab(storage, { self: true, route: null }))).toEqual([]);
  });
});
