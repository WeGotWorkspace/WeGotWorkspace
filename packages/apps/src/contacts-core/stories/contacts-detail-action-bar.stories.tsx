import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ContactsDetailActionBar } from "@/contacts-core/src/contacts-detail-action-bar";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

function ContactsDetailActionBarHarness({
  createMode = false,
  canSaveCreate = true,
  onDownload = fn(),
  onDelete = fn(),
  onSave = fn(),
  onCancel = fn(),
}: {
  createMode?: boolean;
  canSaveCreate?: boolean;
  onDownload?: () => void;
  onDelete?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
}) {
  return (
    <ContactsStoryScope variant="detail">
      <div className="sticky top-0 z-10 border-b px-2 py-2">
        <ContactsDetailActionBar
          labels={defaultContactsLabels}
          createMode={createMode}
          canSaveCreate={canSaveCreate}
          closeMobileDetail={() => {}}
          backLabel="All Contacts"
          onDelete={onDelete}
          onDownload={onDownload}
          onSave={onSave}
          onCancel={onCancel}
        />
      </div>
    </ContactsStoryScope>
  );
}

const meta = {
  title: "Features/Contacts/Panes/Detail action bar",
  component: ContactsDetailActionBarHarness,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    onDownload: fn(),
    onDelete: fn(),
    onSave: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ContactsDetailActionBarHarness>;

export default meta;
type Story = StoryObj<typeof ContactsDetailActionBarHarness>;

/** An open contact: no Edit action (the sheet is always editable), just download and delete. */
export const Open: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const right = canvasElement.querySelector(".action-bar__right");
    await expect(right).toBeTruthy();
    const rightChildren = Array.from(right!.children).map(
      (child) => (child as HTMLElement).className,
    );
    // The address book switcher sits above the name, not in the bar.
    await expect(rightChildren.some((name) => name.includes("action-bar__right-leading"))).toBe(
      false,
    );
    const buttons = within(right as HTMLElement)
      .getAllByRole("button")
      .filter((button) => !button.closest(".action-bar__menu"));
    await expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      defaultContactsLabels.downloadVCard,
      defaultContactsLabels.delete,
    ]);
    await expect(canvas.queryByRole("button", { name: defaultContactsLabels.edit })).toBeNull();
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.delete }).className,
    ).toContain("button--severity-danger");
    await expect(canvas.queryByRole("combobox")).toBeNull();
    const download = canvas.getByRole("button", { name: defaultContactsLabels.downloadVCard });
    await expect(download).toBeEnabled();
    await userEvent.click(download);
    await expect(args.onDownload).toHaveBeenCalled();
  },
};

export const CreateMode: Story = {
  args: { createMode: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: defaultContactsLabels.save }));
    await expect(args.onSave).toHaveBeenCalled();
    await expect(
      canvas.queryByRole("button", { name: defaultContactsLabels.downloadVCard }),
    ).toBeNull();
  },
};
