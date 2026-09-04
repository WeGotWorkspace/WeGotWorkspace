import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import {
  ContactsCreateGroupDialog,
  contactsCreateGroupDialogLabelsFrom,
} from "@/contacts-core/src/contacts-create-group-dialog";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { ContactsStoryScope } from "./contacts-story-scope";

const ownerBook: ContactsAddressBookRow = {
  id: "default",
  name: "Ada",
  description: null,
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

const teamBook: ContactsAddressBookRow = {
  id: "group-eng",
  name: "Engineering",
  description: null,
  sortOrder: 1,
  isDefault: false,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

function ContactsCreateGroupDialogHarness({
  view = "all",
  onConfirm = fn(),
}: {
  view?: string;
  onConfirm?: (name: string, addressBookId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ContactsStoryScope>
      <ContactsCreateGroupDialog
        open={open}
        books={[ownerBook, teamBook]}
        view={view}
        labels={contactsCreateGroupDialogLabelsFrom(defaultContactsLabels)}
        onClose={() => setOpen(false)}
        onConfirm={(name, addressBookId) => {
          onConfirm(name, addressBookId);
          setOpen(false);
        }}
      />
    </ContactsStoryScope>
  );
}

const meta: Meta<typeof ContactsCreateGroupDialogHarness> = {
  title: "Apps/Contacts/Create group dialog",
  component: ContactsCreateGroupDialogHarness,
  args: {
    view: "all",
    onConfirm: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ContactsCreateGroupDialogHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(screen.getByText(defaultContactsLabels.newGroup)).toBeInTheDocument();
    await expect(
      screen.queryByRole("button", { name: defaultContactsLabels.deleteGroup }),
    ).toBeNull();
    await expect(
      screen.getByLabelText(defaultContactsLabels.createGroupAddressBookLabel),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText(defaultContactsLabels.createGroupNameLabel),
      "Studio",
    );
    await userEvent.click(
      screen.getByRole("button", { name: defaultContactsLabels.createGroupButton }),
    );
    await expect(args.onConfirm).toHaveBeenCalledWith("Studio", "default");
  },
};

export const TeamBookInView: Story = {
  args: {
    view: "book:group-eng",
  },
};
