import { describe, expect, it } from "vitest";
import { isInboxTaskList, sortSidebarTaskLists, taskListDotColor } from "@/lib/models/task-lists";

describe("task-lists", () => {
  it("isInboxTaskList uses owned role or uri, never display name", () => {
    expect(isInboxTaskList({ id: "inbox", role: "inbox" })).toBe(true);
    expect(isInboxTaskList({ id: "tl-inbox-uuid", role: "inbox" })).toBe(true);
    expect(isInboxTaskList({ id: "tasks-inbox" })).toBe(true);
    expect(isInboxTaskList({ id: "custom", role: null })).toBe(false);
    expect(isInboxTaskList({ id: "custom" })).toBe(false);
    expect(isInboxTaskList({ id: "shared-inbox", role: "inbox", isSharee: true })).toBe(false);
    expect(isInboxTaskList({ id: "shared-inbox", isSharee: true })).toBe(false);
  });

  it("taskListDotColor prefers explicit list color over hash fallback", () => {
    expect(taskListDotColor({ id: "work", color: "#ff0000" })).toBe("#ff0000");
    expect(taskListDotColor({ id: "work", color: "  #22c55e  " })).toBe("#22c55e");
  });

  it("taskListDotColor falls back to deterministic hash from list id", () => {
    expect(taskListDotColor("work")).toBe(taskListDotColor({ id: "work", color: null }));
    expect(taskListDotColor({ id: "work" })).toBe(taskListDotColor("work"));
  });

  it("sortSidebarTaskLists pins inbox ahead of names that sort before Inbox", () => {
    expect(
      sortSidebarTaskLists([
        { id: "alpha", name: "Alpha" },
        { id: "inbox", name: "Inbox", role: "inbox", isDefault: true },
        { id: "beta", name: "beta" },
      ]).map((list) => list.id),
    ).toEqual(["inbox", "alpha", "beta"]);
  });
});
