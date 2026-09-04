import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { ContactsDetailActionBar } from "@/contacts-core/src/contacts-detail-action-bar";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

const seedBooks = [
  { id: "default", name: "Ada", isDefault: true as const },
  { id: "group-eng", name: "Engineering" },
];

function ContactsDetailActionBarHarness({
  editMode: initialEditMode = false,
  createMode = false,
  onMove = () => {},
}: {
  editMode?: boolean;
  createMode?: boolean;
  onMove?: (bookId: string) => void;
}) {
  const [editMode, setEditMode] = useState(initialEditMode);
  const [bookId, setBookId] = useState("default");

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
          moveAddressBook={
            createMode
              ? undefined
              : {
                  books: seedBooks,
                  value: bookId,
                  onMove: (next) => {
                    setBookId(next);
                    onMove(next);
                  },
                }
          }
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
  title: "Apps/Contacts/Panes/Detail action bar",
  component: ContactsDetailActionBarHarness,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    onMove: fn(),
  },
} satisfies Meta<typeof ContactsDetailActionBarHarness>;

export default meta;
type Story = StoryObj<typeof ContactsDetailActionBarHarness>;

export const ReadMode: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvasElement.querySelector(".action-bar__row");
    await expect(row).toBeTruthy();
    const actions = within(row as HTMLElement);
    const buttons = actions.getAllByRole("button");
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
      canvas.getByRole("combobox", { name: defaultContactsLabels.toolbarMoveToAddressBook }),
    ).toHaveTextContent(defaultContactsLabels.personalAddressBook);
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

export const ChangeAddressBook: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("combobox", {
      name: defaultContactsLabels.toolbarMoveToAddressBook,
    });
    await userEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    await expect(options.map((option) => option.textContent?.trim())).toEqual([
      defaultContactsLabels.personalAddressBook,
      "Engineering",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "Engineering" }));
    await expect(args.onMove).toHaveBeenCalledWith("group-eng");
  },
};
