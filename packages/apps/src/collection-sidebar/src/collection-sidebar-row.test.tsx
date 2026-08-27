import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";

describe("CollectionSidebarRow", () => {
  it("calls onSelect from the row and onToggleVisibility from the checkbox independently", () => {
    const onSelect = vi.fn();
    const onToggleVisibility = vi.fn();
    render(
      <ul>
        <CollectionSidebarRow
          name="Work"
          color="#0ea5e9"
          visible
          onSelect={onSelect}
          onToggleVisibility={onToggleVisibility}
        />
      </ul>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onToggleVisibility).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Work" }));
    expect(onToggleVisibility).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("omits the checkbox when onToggleVisibility is not provided", () => {
    render(
      <ul>
        <CollectionSidebarRow name="Inbox" color="#6366f1" onSelect={vi.fn()} showColorDot />
      </ul>,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Inbox" })).toBeTruthy();
  });
});
