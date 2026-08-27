import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TASKS_VIEW_PREFS_STORAGE_KEY } from "@/tasks-core/src/tasks-view-prefs";
import { useTasksHiddenIds } from "@/tasks-core/src/use-tasks-hidden-ids";

const baseLists = [
  { id: "inbox", name: "Inbox" },
  { id: "work", name: "Work" },
  { id: "shared", name: "Shared", isVisible: false },
];

describe("useTasksHiddenIds", () => {
  beforeEach(() => {
    window.localStorage.removeItem(TASKS_VIEW_PREFS_STORAGE_KEY);
  });

  it("keeps a server-default-hidden list visible after the user un-hides it", () => {
    const first = renderHook(() => useTasksHiddenIds(baseLists));
    expect(first.result.current.hiddenTaskListIds.has("shared")).toBe(true);

    act(() => {
      first.result.current.setHiddenTaskListIds(new Set());
    });
    expect(first.result.current.hiddenTaskListIds.has("shared")).toBe(false);
    first.unmount();

    const second = renderHook(() => useTasksHiddenIds(baseLists));
    expect(second.result.current.hiddenTaskListIds.has("shared")).toBe(false);
  });

  it("hides a newly arrived server-default-hidden list without a remount", () => {
    const { result, rerender } = renderHook(({ lists }) => useTasksHiddenIds(lists), {
      initialProps: { lists: baseLists },
    });

    rerender({
      lists: [...baseLists, { id: "birthdays", name: "Birthdays", isVisible: false }],
    });

    expect(result.current.hiddenTaskListIds.has("birthdays")).toBe(true);
  });
});
