import { describe, expect, it } from "vitest";
import { createIdListStore } from "./id-list-store";
import { notificationInProjectScope } from "./notification-scope";
import { pickRowsToToast, TOAST_DECIDED_STORAGE_KEY } from "./notification-toast-decision";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";

function row(id: string, projectId?: string | null): NotificationInboxItem {
  return {
    id,
    domain: "tasks",
    action: "assigned",
    title: "Task",
    body: null,
    navigate: "/tasks",
    tag: null,
    projectId,
    readAt: null,
    createdAt: "2026-11-22T10:00:00Z",
  };
}

describe("notificationInProjectScope", () => {
  it("keeps only the rows of the selected Project", () => {
    expect(notificationInProjectScope(row("a", "p1"), ["p1"])).toBe(true);
    expect(notificationInProjectScope(row("b", "p2"), ["p1"])).toBe(false);
  });

  it("keeps the rows of every Project of a Team", () => {
    const team = ["p1", "p2"];
    expect(notificationInProjectScope(row("a", "p1"), team)).toBe(true);
    expect(notificationInProjectScope(row("b", "p2"), team)).toBe(true);
    expect(notificationInProjectScope(row("c", "p3"), team)).toBe(false);
  });

  it("does not narrow for All Projects", () => {
    expect(notificationInProjectScope(row("a", "p9"), null)).toBe(true);
  });

  it("always keeps a row with no Project, so DMs and personal invites never disappear", () => {
    expect(notificationInProjectScope(row("a", null), ["p1"])).toBe(true);
    expect(notificationInProjectScope(row("b"), ["p1"])).toBe(true);
    expect(notificationInProjectScope(row("c", null), [])).toBe(true);
  });
});

describe("pickRowsToToast with the Project filter", () => {
  function deps(projectIds: readonly string[] | null) {
    const values = new Map<string, string>();
    return {
      frontTab: async () => ({ self: true, route: "/drive" }),
      decided: createIdListStore(
        {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => void values.set(key, value),
        },
        TOAST_DECIDED_STORAGE_KEY,
        500,
      ),
      currentRoute: () => "/drive",
      visibleSince: () => 0,
      inScope: (item: NotificationInboxItem) => notificationInProjectScope(item, projectIds),
    };
  }

  it("does not toast a row of another Project, and still toasts the rest", async () => {
    const picked = await pickRowsToToast(
      [row("a", "p1"), row("b", "p2"), row("c", null)],
      deps(["p1"]),
    );
    expect(picked.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("toasts every row for All Projects", async () => {
    const picked = await pickRowsToToast([row("a", "p1"), row("b", "p2")], deps(null));
    expect(picked.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
