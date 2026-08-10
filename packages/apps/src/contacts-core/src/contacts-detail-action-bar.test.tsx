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
  });

  it("shows edit and delete actions in read mode", () => {
    renderActionBar();
    expect(screen.getByRole("button", { name: defaultContactsLabels.edit })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultContactsLabels.delete })).toBeTruthy();
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

  it("shows save and cancel actions in create mode", () => {
    renderActionBar({ createMode: true, editMode: false });
    expect(screen.getByRole("button", { name: defaultContactsLabels.save })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultContactsLabels.cancel })).toBeTruthy();
  });
});
