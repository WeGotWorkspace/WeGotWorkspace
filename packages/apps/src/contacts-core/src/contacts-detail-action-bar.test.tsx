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
        createMode={false}
        closeMobileDetail={() => {}}
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

  it("shows download and delete only, with no edit action (the sheet is always editable)", () => {
    const { container } = renderActionBar();
    const right = container.querySelector(".action-bar__right");
    expect(right).toBeTruthy();
    const buttons = within(right as HTMLElement)
      .getAllByRole("button")
      .filter((button) => !button.closest(".action-bar__menu"));
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      defaultContactsLabels.downloadVCard,
      defaultContactsLabels.delete,
    ]);
    expect(screen.queryByRole("button", { name: defaultContactsLabels.edit })).toBeNull();
    expect(buttons[1].className).toContain("button--severity-danger");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("collapses download and delete into the narrow menu and never disables download", () => {
    const { container } = renderActionBar();
    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();

    const actions = within(row as HTMLElement);
    const download = actions.getByRole("button", {
      name: defaultContactsLabels.downloadVCard,
    }) as HTMLButtonElement;
    const deleteButton = actions.getByRole("button", {
      name: defaultContactsLabels.delete,
    }) as HTMLButtonElement;

    expect(download.disabled).toBe(false);
    expect(deleteButton.disabled).toBe(false);
    expect(download.className).toContain("action-bar__action--collapse-narrow");
    expect(deleteButton.className).toContain("action-bar__action--collapse-narrow");
    expect(container.querySelector(".action-bar__menu--narrow")).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.save })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.cancel })).toBeNull();
  });

  it("calls download and delete from the bar", () => {
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderActionBar({ onDownload, onDelete });
    const row = within(container.querySelector(".action-bar__row") as HTMLElement);

    fireEvent.click(row.getByRole("button", { name: defaultContactsLabels.downloadVCard }));
    fireEvent.click(row.getByRole("button", { name: defaultContactsLabels.delete }));

    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
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
  });

  it("shows save and cancel actions in create mode", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderActionBar({ createMode: true, onSave, onCancel });
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.save }));
    fireEvent.click(screen.getByRole("button", { name: defaultContactsLabels.cancel }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: defaultContactsLabels.downloadVCard })).toBeNull();
  });

  it("disables save in create mode until the new contact can be saved", () => {
    renderActionBar({ createMode: true, canSaveCreate: false });
    const save = screen.getByRole("button", {
      name: defaultContactsLabels.save,
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
