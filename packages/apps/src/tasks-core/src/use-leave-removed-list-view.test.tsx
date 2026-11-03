import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_VIEW } from "@/tasks-core/src/tasks-route-search";
import { useLeaveRemovedListView } from "@/tasks-core/src/use-leave-removed-list-view";

type Props = { view: string; lists: { id: string }[] };

function render(initial: Props) {
  const selectView = vi.fn();
  const hook = renderHook(
    ({ view, lists }: Props) => useLeaveRemovedListView(view, lists, selectView),
    { initialProps: initial },
  );
  return { selectView, rerender: hook.rerender };
}

describe("useLeaveRemovedListView", () => {
  it("leaves the open list when it is removed elsewhere", () => {
    const { selectView, rerender } = render({ view: "list:shared", lists: [{ id: "shared" }] });
    expect(selectView).not.toHaveBeenCalled();

    rerender({ view: "list:shared", lists: [] });

    expect(selectView).toHaveBeenCalledWith(DEFAULT_TASKS_VIEW);
  });

  it("keeps a list view whose list has not loaded yet", () => {
    const { selectView, rerender } = render({ view: "list:linked", lists: [] });
    rerender({ view: "list:linked", lists: [{ id: "other" }] });

    expect(selectView).not.toHaveBeenCalled();
  });

  it("keeps other views when a list is removed", () => {
    const { selectView, rerender } = render({ view: "state:all", lists: [{ id: "shared" }] });
    rerender({ view: "state:all", lists: [] });

    expect(selectView).not.toHaveBeenCalled();
  });
});
