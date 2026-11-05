import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ContactsDetailActionBar } from "@/contacts-core/src/contacts-detail-action-bar";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

function ContactsDetailActionBarHarness({
  editMode: initialEditMode = false,
  createMode = false,
}: {
  editMode?: boolean;
  createMode?: boolean;
}) {
  const [editMode, setEditMode] = useState(initialEditMode);

  return (
    <ContactsStoryScope variant="detail">
      <div className="sticky top-0 z-10 border-b px-2 py-2">
        <ContactsDetailActionBar
          labels={defaultContactsLabels}
          canEdit
          editMode={editMode}
          createMode={createMode}
          closeMobileDetail={() => {}}
          backLabel="All Contacts"
          onEdit={() => setEditMode(true)}
          onDelete={() => {}}
          onDownload={() => {}}
          onSave={() => {}}
          onCancel={() => setEditMode(false)}
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
} satisfies Meta<typeof ContactsDetailActionBarHarness>;

export default meta;
type Story = StoryObj<typeof ContactsDetailActionBarHarness>;

export const ReadMode: Story = {
  args: {},
  play: async ({ canvasElement }) => {
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
    const buttons = within(right as HTMLElement).getAllByRole("button");
    await expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      defaultContactsLabels.edit,
      defaultContactsLabels.downloadVCard,
      defaultContactsLabels.delete,
    ]);
    await expect(buttons[0].textContent).toContain(defaultContactsLabels.edit);
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.edit }).className,
    ).toContain("action-bar__action--labeled");
    await expect(
      canvas.getByRole("button", { name: defaultContactsLabels.delete }).className,
    ).toContain("button--severity-danger");
    await expect(canvas.queryByRole("combobox")).toBeNull();
  },
};

export const EditMode: Story = {
  args: { editMode: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editButton = canvas.getByRole("button", { name: defaultContactsLabels.edit });
    await userEvent.click(editButton);
    await expect(editButton.className).not.toContain("icon-button--active");
  },
};

export const CreateMode: Story = {
  args: { createMode: true, editMode: true },
};
