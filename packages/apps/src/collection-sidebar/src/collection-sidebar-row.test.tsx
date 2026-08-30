import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";

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

  it("exposes collection color as --collection-row-color for the visibility checkbox", () => {
    render(
      <ul>
        <CollectionSidebarRow
          name="Work"
          color="#0ea5e9"
          visible
          onSelect={vi.fn()}
          onToggleVisibility={vi.fn()}
        />
      </ul>,
    );
    const row = screen.getByText("Work").closest(".collection-sidebar-row") as HTMLElement;
    expect(row.style.getPropertyValue("--collection-row-color")).toBe("#0ea5e9");
    expect(screen.getByRole("checkbox", { name: "Hide Work" }).className).toMatch(
      /collection-sidebar-row__visibility/,
    );
  });

  it("keeps hover-edit when onEdit is provided", () => {
    const onEdit = vi.fn();
    render(
      <TooltipProvider>
        <ul>
          <CollectionSidebarRow
            name="Drafts"
            color="#14b8a6"
            onSelect={vi.fn()}
            onEdit={onEdit}
            editLabel="Edit"
          />
        </ul>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
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

  it("keeps the shared BEM block when Calendar aliases calendar-sidebar-row", () => {
    render(
      <ul>
        <CollectionSidebarRow
          name="Work"
          color="#0ea5e9"
          selected
          blockName="calendar-sidebar-row"
          onSelect={vi.fn()}
          onToggleVisibility={vi.fn()}
        />
      </ul>,
    );
    const row = screen.getByText("Work").closest(".collection-sidebar-row");
    expect(row?.className).toMatch(/collection-sidebar-row--selected/);
    expect(row?.className).toMatch(/calendar-sidebar-row--selected/);
  });

  it("renders CollectionSidebarMark with the shared mark class", () => {
    render(
      <TooltipProvider>
        <CollectionSidebarMark label="View only">
          <span>eye</span>
        </CollectionSidebarMark>
      </TooltipProvider>,
    );
    expect(screen.getByRole("img", { name: "View only" }).className).toMatch(
      /collection-sidebar-row__mark/,
    );
  });
});
