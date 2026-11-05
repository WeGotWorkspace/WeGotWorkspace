import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactsDetailActionBar } from "./contacts-detail-action-bar";
import { defaultContactsLabels } from "./contacts-labels";

afterEach(() => {
  cleanup();
});

function renderActionBar(props: Partial<ComponentProps<typeof ContactsDetailActionBar>> = {}) {
  return render(
    <TooltipProvider>
      <ContactsDetailActionBar
        labels={defaultContactsLabels}
        canEdit
        editMode={false}
        createMode={false}
        closeMobileDetail={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onDownload={() => {}}
        onSave={() => {}}
        onCancel={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("ContactsDetailActionBar", () => {
  it("shows the list name on the mobile back control", () => {
    renderActionBar({ backLabel: "All Contacts" });
    const back = screen.getByRole("button", { name: "All Contacts" });
    expect(back.textContent).toContain("All Contacts");
    expect(back.className).toContain("action-bar__back");
    expect(back.className).toContain("button--variant-outline");
  });

  it("shows a labeled edit action first in read mode", () => {
    const { container } = renderActionBar();
    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();

    const actions = within(row as HTMLElement);
    const buttons = actions.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      defaultContactsLabels.edit,
      defaultContactsLabels.downloadVCard,
      defaultContactsLabels.delete,
    ]);

    const edit = buttons[0];
    expect(edit.getAttribute("aria-label")).toBe(defaultContactsLabels.edit);
    expect(edit.textContent).toContain(defaultContactsLabels.edit);
    expect(edit.querySelector(".button__label")?.textContent).toBe(defaultContactsLabels.edit);
    expect(edit.className).toContain("action-bar__action--labeled");
    expect(edit.className).toContain("action-bar__action--icon-narrow");
    expect(buttons[1].textContent).not.toContain(defaultContactsLabels.downloadVCard);
    expect(buttons[2].textContent).not.toContain(defaultContactsLabels.delete);
    expect(buttons[1].className).toContain("action-bar__action--collapse-narrow");
    expect(buttons[2].className).toContain("action-bar__action--collapse-narrow");
    expect(container.querySelector(".action-bar__menu--narrow")).toBeTruthy();
  });

  it("orders edit, download, delete with no address-book switcher (it sits above the name)", () => {
    const { container } = renderActionBar();
    const right = container.querySelector(".action-bar__right");
    expect(right).toBeTruthy();
    const buttons = within(right as HTMLElement)
      .getAllByRole("button")
      .filter((button) => !button.closest(".action-bar__menu"));
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      defaultContactsLabels.edit,
      defaultContactsLabels.downloadVCard,
      defaultContactsLabels.delete,
    ]);
    expect(buttons[0].className).toContain("action-bar__action--labeled");
    expect(buttons[2].className).toContain("button--severity-danger");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("keeps read actions visible while editing with correct disabled states", () => {
    const { container } = renderActionBar({ editMode: true });
    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();

    const actions = within(row as HTMLElement);
    const download = actions.getByRole("button", {
      name: defaultContactsLabels.downloadVCard,
    }) as HTMLButtonElement;
    const edit = actions.getByRole("button", {
      name: defaultContactsLabels.edit,
    }) as HTMLButtonElement;
    const deleteButton = actions.getByRole("button", {
      name: defaultContactsLabels.delete,
    }) as HTMLButtonElement;

    expect(download.disabled).toBe(true);
    expect(edit.disabled).toBe(false);
    expect(deleteButton.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: defaultContactsLabels.save })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.cancel })).toBeNull();
  });

  it("toggles edit off via the active edit button", () => {
    const onCancel = vi.fn();
    const { container } = renderActionBar({ editMode: true, onCancel });
    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();

    const actions = within(row as HTMLElement);
    fireEvent.click(actions.getByRole("button", { name: defaultContactsLabels.edit }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("puts download and delete in the overflow menu and keeps them working", () => {
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderActionBar({ onDownload, onDelete });
    const menu = container.querySelector(".action-bar__menu--narrow");
    expect(menu).toBeTruthy();

    const trigger = menu!.querySelector("button") as HTMLButtonElement;
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "More actions" })).getByRole("menuitem", {
        name: defaultContactsLabels.downloadVCard,
      }),
    );
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "More actions" })).getByRole("menuitem", {
        name: defaultContactsLabels.delete,
      }),
    );

    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: defaultContactsLabels.edit }).className,
    ).not.toContain("action-bar__action--collapse-narrow");
  });

  it("shows save and cancel actions in create mode", () => {
    renderActionBar({ createMode: true, editMode: false });
    expect(screen.getByRole("button", { name: defaultContactsLabels.save })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultContactsLabels.cancel })).toBeTruthy();
  });
});
