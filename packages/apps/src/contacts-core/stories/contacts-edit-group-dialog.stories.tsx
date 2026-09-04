import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import {
  ContactsEditGroupDialog,
  contactsEditGroupDialogLabelsFrom,
} from "@/contacts-core/src/contacts-edit-group-dialog";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

const ownerBook = { id: "default", name: "Ada" };
const adminBook = { id: "group-admin", name: "Admin" };
const administratorsBook = { id: "group-administrators", name: "Administrators" };
const books = [ownerBook, adminBook, administratorsBook];

function ContactsEditGroupDialogHarness({
  canDelete = true,
  addressBookIds = { default: true as const },
  onConfirm = fn(),
  onDelete = fn(),
}: {
  canDelete?: boolean;
  addressBookIds?: Record<string, true>;
  onConfirm?: (name: string) => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ContactsStoryScope>
      <ContactsEditGroupDialog
        open={open}
        name="Friends"
        addressBookIds={addressBookIds}
        books={books}
        labels={contactsEditGroupDialogLabelsFrom(defaultContactsLabels)}
        canDelete={canDelete}
        onClose={() => setOpen(false)}
        onConfirm={(name) => {
          onConfirm(name);
          setOpen(false);
        }}
        onDelete={
          canDelete
            ? () => {
                onDelete();
                setOpen(false);
              }
            : undefined
        }
      />
    </ContactsStoryScope>
  );
}

const meta: Meta<typeof ContactsEditGroupDialogHarness> = {
  title: "Apps/Contacts/Edit group dialog",
  component: ContactsEditGroupDialogHarness,
  args: {
    canDelete: true,
    addressBookIds: { default: true },
    onConfirm: fn(),
    onDelete: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ContactsEditGroupDialogHarness>;

function bookTrigger() {
  return screen.getByRole("combobox", { name: defaultContactsLabels.createGroupAddressBookLabel });
}

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(screen.getByText(defaultContactsLabels.renameGroup)).toBeInTheDocument();
    await expect(
      screen.getByRole("button", { name: defaultContactsLabels.deleteGroup }),
    ).toBeInTheDocument();
    const book = bookTrigger();
    await expect(book).toBeDisabled();
    await expect(book).toHaveTextContent("Personal");
    const name = screen.getByLabelText(defaultContactsLabels.createGroupNameLabel);
    await userEvent.clear(name);
    await userEvent.type(name, "Close Friends");
    await userEvent.click(screen.getByRole("button", { name: defaultContactsLabels.save }));
    await expect(args.onConfirm).toHaveBeenCalledWith("Close Friends");
  },
};

export const AdministratorsBook: Story = {
  tags: ["vitest-ci"],
  args: {
    addressBookIds: { "group-administrators": true },
  },
  play: async () => {
    const book = bookTrigger();
    await expect(book).toBeDisabled();
    await expect(book).toHaveTextContent("Administrators");
    await expect(book).not.toHaveTextContent(/^Admin$/);
  },
};

export const AdminBook: Story = {
  tags: ["vitest-ci"],
  args: {
    addressBookIds: { "group-admin": true },
  },
  play: async () => {
    const book = bookTrigger();
    await expect(book).toBeDisabled();
    await expect(book.textContent?.replace(/\s+/g, " ").trim()).toBe("Admin");
  },
};

export const WithoutDelete: Story = {
  tags: ["vitest-ci"],
  args: {
    canDelete: false,
  },
  play: async () => {
    await expect(
      screen.queryByRole("button", { name: defaultContactsLabels.deleteGroup }),
    ).toBeNull();
    await expect(bookTrigger()).toBeDisabled();
  },
};
