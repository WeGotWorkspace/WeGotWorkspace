import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useListItemHighlight } from "@/list-item/src/list-item-selection";
import { ListItem } from "@/list-item/src/list-item";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";

function SelectionProbe({ id, onRender }: { id: string; onRender: (id: string) => void }) {
  onRender(id);
  const highlight = useListItemHighlight(id, {
    isActive: false,
    isSelected: false,
  });
  return <span data-probe={id} data-selected={highlight.isSelected ? "true" : "false"} />;
}

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

  it("updates only the store highlight when activeId changes", () => {
    const { rerender } = render(
      <WorkspaceSwipeList isTouch={false} onItemClick={vi.fn()} activeId="a" selectedIds={["a"]}>
        {row("a", "Ada")}
        {row("b", "Bea")}
      </WorkspaceSwipeList>,
    );

    expect(screen.getByRole("button", { name: /Ada/i }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("button", { name: /Bea/i }).getAttribute("data-active")).toBe("false");

    rerender(
      <WorkspaceSwipeList isTouch={false} onItemClick={vi.fn()} activeId="b" selectedIds={["b"]}>
        {row("a", "Ada")}
        {row("b", "Bea")}
      </WorkspaceSwipeList>,
    );

    expect(screen.getByRole("button", { name: /Ada/i }).getAttribute("data-active")).toBe("false");
    expect(screen.getByRole("button", { name: /Bea/i }).getAttribute("data-active")).toBe("true");
  });

  it("keeps the original row id when swipe list overwrites React id", () => {
    const onItemClick = vi.fn();
    render(
      <WorkspaceSwipeList isTouch onItemClick={onItemClick}>
        {row("note-1", "Ada")}
        {row("note-2", "Bea")}
      </WorkspaceSwipeList>,
    );

    const bea = screen.getByRole("button", { name: /Bea/i });
    expect(bea.getAttribute("data-list-item-id")).toBe("note-2");
    fireEvent.click(bea);
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick.mock.calls[0]?.[0]).toBe("note-2");
  });

  it("updates memoized rows on each selection change without rerendering the rest", () => {
    const renders: string[] = [];
    const probes = ["a", "b"].map((id) => (
      <SelectionProbe key={id} id={id} onRender={(rowId) => renders.push(rowId)} />
    ));
    const { rerender, container } = render(
      <WorkspaceSwipeList isTouch={false} activeId="" selectedIds={[]} selectionMode={false}>
        {probes}
      </WorkspaceSwipeList>,
    );

    renders.length = 0;
    rerender(
      <WorkspaceSwipeList isTouch={false} activeId="" selectedIds={["a"]} selectionMode>
        {probes}
      </WorkspaceSwipeList>,
    );

    expect(container.querySelector("[data-probe='a']")?.getAttribute("data-selected")).toBe("true");
    expect(container.querySelector("[data-probe='b']")?.getAttribute("data-selected")).toBe(
      "false",
    );
    expect(renders).toEqual(["a"]);

    renders.length = 0;
    rerender(
      <WorkspaceSwipeList isTouch={false} activeId="" selectedIds={["a", "b"]} selectionMode>
        {probes}
      </WorkspaceSwipeList>,
    );

    expect(container.querySelector("[data-probe='b']")?.getAttribute("data-selected")).toBe("true");
    expect(renders).toEqual(["b"]);
    expect(
      container
        .querySelector("[data-list-selection-mode]")
        ?.getAttribute("data-list-selection-mode"),
    ).toBe("true");
  });

  it("leaves row selection mode to the list root", () => {
    const { container } = render(
      <WorkspaceSwipeList isTouch={false} selectionMode activeId="" selectedIds={["a"]}>
        {row("a", "Ada")}
      </WorkspaceSwipeList>,
    );
    const button = screen.getByRole("button", { name: /Ada/i });
    expect(button.hasAttribute("data-selection-mode")).toBe(false);
    expect(button.getAttribute("data-selected")).toBe("true");
    expect(
      container
        .querySelector("[data-list-selection-mode]")
        ?.getAttribute("data-list-selection-mode"),
    ).toBe("true");
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
