import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsNewMenu } from "@/contacts-core/src/contacts-new-menu";

const L = defaultContactsLabels;

describe("ContactsNewMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  it("creates a contact from the main control without opening a menu", () => {
    const onCreateContact = vi.fn();
    render(
      <ContactsNewMenu
        labels={L}
        onCreateContact={onCreateContact}
        onCreateGroup={vi.fn()}
        onImportVcf={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.newContact }));

    expect(onCreateContact).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: L.newGroup })).toBeNull();
  });

  it("opens New group from the chevron when create-group is allowed", () => {
    const onCreateGroup = vi.fn();
    render(<ContactsNewMenu labels={L} onCreateContact={vi.fn()} onCreateGroup={onCreateGroup} />);

    const chevron = screen.getByRole("button", { name: L.newContactMenu });
    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: L.newGroup }));
    expect(onCreateGroup).toHaveBeenCalledOnce();
  });

  it("hides New group when create-group is not allowed", () => {
    render(<ContactsNewMenu labels={L} onCreateContact={vi.fn()} onImportVcf={vi.fn()} />);

    const chevron = screen.getByRole("button", { name: L.newContactMenu });
    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    expect(screen.queryByRole("button", { name: L.newGroup })).toBeNull();
    expect(screen.getByRole("button", { name: L.importVcf })).toBeTruthy();
  });

  it("hides the chevron when neither group create nor import is available", () => {
    render(<ContactsNewMenu labels={L} onCreateContact={vi.fn()} />);

    const main = screen.getByRole("button", { name: L.newContact });
    expect(main.className).toMatch(/sidebar-segmented-new-menu__main--solo/);
    expect(screen.queryByRole("button", { name: L.newContactMenu })).toBeNull();
  });
});
