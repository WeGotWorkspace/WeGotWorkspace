import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListItem } from "@/list-item/src/list-item";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";

const row = (id: string, title: string) => (
  <ListItem
    id={id}
    title={title}
    subtitle=""
    date=""
    isActive={false}
    isSelected={false}
    selectionMode={false}
    isTouch={false}
    isDragging={false}
  />
);

describe("WorkspaceSwipeList event delegation", () => {
  it("fires one parent click handler with the row id", () => {
    const onItemClick = vi.fn();
    render(
      <WorkspaceSwipeList isTouch={false} onItemClick={onItemClick}>
        {row("a", "Ada")}
        {row("b", "Bea")}
      </WorkspaceSwipeList>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Bea/i }));
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick.mock.calls[0]?.[0]).toBe("b");
  });

  it("ignores clicks that are not on a list row", () => {
    const onItemClick = vi.fn();
    render(
      <WorkspaceSwipeList isTouch={false} onItemClick={onItemClick}>
        <p>Letter A</p>
        {row("a", "Ada")}
      </WorkspaceSwipeList>,
    );

    fireEvent.click(screen.getByText("Letter A"));
    expect(onItemClick).not.toHaveBeenCalled();
  });
});
