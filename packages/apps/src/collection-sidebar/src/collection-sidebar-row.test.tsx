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

  it("renders a leading mark in the shared leading column", () => {
    render(
      <ul>
        <CollectionSidebarRow
          name="Friends"
          color="#6366f1"
          onSelect={vi.fn()}
          leading={<span data-testid="leading-mark" aria-hidden />}
        />
      </ul>,
    );
    const row = screen.getByText("Friends").closest(".collection-sidebar-row") as HTMLElement;
    expect(row.querySelector(".collection-sidebar-row__leading")).toBeTruthy();
    expect(screen.getByTestId("leading-mark")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Edit" }).className).toMatch(/icon-button--size-xs/);
  });

  it("renders a leading avatar mark in the shared leading column", () => {
    render(
      <ul>
        <CollectionSidebarRow
          name="Ada Lovelace"
          color="#06b6d4"
          onSelect={vi.fn()}
          leading={<span data-testid="dm-avatar">AL</span>}
        />
      </ul>,
    );
    const row = screen.getByText("Ada Lovelace").closest(".collection-sidebar-row") as HTMLElement;
    expect(row.querySelector(".collection-sidebar-row__leading")).toBeTruthy();
    expect(row.querySelector("[data-testid='dm-avatar']")?.textContent).toBe("AL");
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

  it("folds from a trailing expand control without selecting the row", () => {
    const onSelect = vi.fn();
    const onToggleExpand = vi.fn();
    render(
      <TooltipProvider>
        <ul>
          <CollectionSidebarRow
            name="Personal"
            color="#22c55e"
            expanded
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            expandLabel="Collapse Personal"
          />
        </ul>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse Personal" }));
    expect(onToggleExpand).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Collapse Personal" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("marks nested and related rows without treating related as selected", () => {
    render(
      <ul>
        <CollectionSidebarRow name="Personal" color="#22c55e" related onSelect={vi.fn()} />
        <CollectionSidebarRow name="Friends" color="#22c55e" nested selected onSelect={vi.fn()} />
      </ul>,
    );
    const parent = screen.getByText("Personal").closest(".collection-sidebar-row");
    const child = screen.getByText("Friends").closest(".collection-sidebar-row");
    expect(parent?.className).toMatch(/collection-sidebar-row--related/);
    expect(parent?.className).not.toMatch(/collection-sidebar-row--selected/);
    expect(child?.className).toMatch(/collection-sidebar-row--nested/);
    expect(child?.className).toMatch(/collection-sidebar-row--selected/);
  });

  it("selects from the row chrome including leading column marks", () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <CollectionSidebarRow
          name="Ada Lovelace"
          color="#06b6d4"
          onSelect={onSelect}
          showColorDot
          leading={<span data-testid="presence" />}
          trailing={<span data-testid="unread">2</span>}
        />
      </ul>,
    );
    const row = screen.getByText("Ada Lovelace").closest(".collection-sidebar-row") as HTMLElement;
    const select = screen.getByRole("button", { name: /Ada Lovelace/ });
    expect(
      row.querySelector(".collection-sidebar-row__leading .collection-sidebar-row__dot"),
    ).toBeTruthy();
    expect(
      row.querySelector(".collection-sidebar-row__leading [data-testid='presence']"),
    ).toBeTruthy();
    expect(select.querySelector(".collection-sidebar-row__dot")).toBeNull();
    fireEvent.click(select);
    fireEvent.click(screen.getByTestId("unread"));
    fireEvent.click(screen.getByText("Ada Lovelace"));
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("puts visibility and icon leading in the same fixed-width column", () => {
    render(
      <ul>
        <CollectionSidebarRow
          name="Personal"
          color="#22c55e"
          onSelect={vi.fn()}
          onToggleVisibility={vi.fn()}
        />
        <CollectionSidebarRow
          name="Family"
          color="#22c55e"
          onSelect={vi.fn()}
          leading={<span data-testid="group-icon" aria-hidden />}
        />
      </ul>,
    );
    const personal = screen.getByText("Personal").closest(".collection-sidebar-row") as HTMLElement;
    const family = screen.getByText("Family").closest(".collection-sidebar-row") as HTMLElement;
    const personalLeading = personal.querySelector(".collection-sidebar-row__leading");
    const familyLeading = family.querySelector(".collection-sidebar-row__leading");
    expect(personalLeading?.querySelector(".collection-sidebar-row__visibility")).toBeTruthy();
    expect(familyLeading?.querySelector("[data-testid='group-icon']")).toBeTruthy();
    expect(
      personal.querySelector(".collection-sidebar-row__select .collection-sidebar-row__leading"),
    ).toBeNull();
    expect(
      family.querySelector(".collection-sidebar-row__select .collection-sidebar-row__leading"),
    ).toBeNull();
  });

  it("keeps a trailing menu clickable without selecting the row", () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    render(
      <ul>
        <CollectionSidebarRow
          name="Inbox"
          color="#6366f1"
          onSelect={onSelect}
          trailing={
            <button type="button" aria-label="Channel menu" onClick={onMenu}>
              More
            </button>
          }
        />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Channel menu" }));
    expect(onMenu).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
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
