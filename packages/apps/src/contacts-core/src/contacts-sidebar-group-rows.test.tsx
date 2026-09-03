import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { addressBookDotColor } from "./contacts-addressbook-color";
import { ContactsSidebarGroupRows } from "./contacts-sidebar-group-rows";
import type { ContactCard } from "./contacts-types";

afterEach(() => {
  cleanup();
});

const friendsGroup = {
  "@type": "Card",
  version: "1.0",
  id: "group-friends",
  uid: "urn:uuid:group-friends",
  kind: "group",
  name: { full: "Friends" },
  addressBookIds: { default: true },
} as unknown as ContactCard;

const orphanGroup = {
  ...friendsGroup,
  id: "group-orphan",
  name: { full: "Orphan" },
  addressBookIds: {},
} as unknown as ContactCard;

describe("ContactsSidebarGroupRows", () => {
  it("tints the group icon from the address book color and opens edit", () => {
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ContactsSidebarGroupRows
          groups={[friendsGroup]}
          view="all"
          editLabel="Rename group"
          canEditGroup={() => true}
          onSelect={onSelect}
          onEdit={onEdit}
          dropZoneProps={() => ({ isDropTarget: false })}
        />
      </TooltipProvider>,
    );

    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe(
      addressBookDotColor({ id: "default" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Friends" }));
    expect(onSelect).toHaveBeenCalledWith("group-friends");
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rename group" }));
    expect(onEdit).toHaveBeenCalledWith(friendsGroup);
  });

  it("hides edit when the group is not writable and leaves unresolved icons untinted", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ContactsSidebarGroupRows
          groups={[orphanGroup]}
          view="all"
          editLabel="Rename group"
          canEditGroup={() => false}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
          dropZoneProps={() => ({ isDropTarget: false })}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByRole("button", { name: "Rename group" })).toBeNull();
    const icon = container.querySelector(".contacts-group-icon") as HTMLElement | null;
    expect(icon).toBeTruthy();
    expect(icon?.style.getPropertyValue("--collection-row-color")).toBe("");
  });

  it("indents nested group rows under a book", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ContactsSidebarGroupRows
          nested
          groups={[friendsGroup]}
          view="all"
          editLabel="Rename group"
          canEditGroup={() => false}
          onSelect={vi.fn()}
          onEdit={vi.fn()}
          dropZoneProps={() => ({ isDropTarget: false })}
        />
      </TooltipProvider>,
    );
    const row = screen.getByText("Friends").closest(".collection-sidebar-row");
    expect(row?.className).toMatch(/collection-sidebar-row--nested/);
  });
});
