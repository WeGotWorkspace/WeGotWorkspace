import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen } from "storybook/test";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import {
  ContactsAddressBookDialog,
  contactsAddressBookDialogLabelsFrom,
  type ContactsAddressBookDialogState,
} from "@/contacts-core/src/contacts-addressbook-dialog";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";

const PRINCIPALS: CollectionSharePrincipal[] = [
  { id: "alice", displayName: "Alice", principalType: "user" },
];

function ContactsAddressBookDialogHarness({
  initial,
}: {
  initial: Exclude<ContactsAddressBookDialogState, null>;
}) {
  const [dialog, setDialog] = useState<ContactsAddressBookDialogState>(initial);
  const [shareWith, setShareWith] = useState<CollectionShareWith | null>(initial.shareWith);
  return (
    <ContactsAddressBookDialog
      dialog={dialog ? { ...dialog, shareWith } : null}
      labels={contactsAddressBookDialogLabelsFrom(defaultContactsLabels)}
      onClose={() => setDialog(null)}
      onRemoveShared={dialog?.isSharee ? () => setDialog(null) : undefined}
      share={
        dialog?.mayShare
          ? {
              knownPrincipals: PRINCIPALS,
              online: true,
              onSearchPrincipals: async () => [...PRINCIPALS],
              onPatchShareWith: async (_id, next) => {
                setShareWith(next);
              },
            }
          : undefined
      }
    />
  );
}

const meta: Meta<typeof ContactsAddressBookDialogHarness> = {
  title: "Apps/Contacts/Address book dialog",
  component: ContactsAddressBookDialogHarness,
};

export default meta;
type Story = StoryObj<typeof ContactsAddressBookDialogHarness>;

export const ShareSettings: Story = {
  tags: ["vitest-ci"],
  args: {
    initial: {
      bookId: "default",
      name: "Ada",
      mayShare: true,
      isSharee: false,
      shareWith: { alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false } },
    },
  },
  play: async () => {
    await expect(screen.getByLabelText(defaultContactsLabels.addressBookNameLabel)).toHaveAttribute(
      "readonly",
    );
    await expect(screen.getByText(defaultContactsLabels.shareAddressBookTitle)).toBeInTheDocument();
    await expect(screen.queryByRole("button", { name: defaultContactsLabels.delete })).toBeNull();
  },
};

export const ShareeHide: Story = {
  tags: ["vitest-ci"],
  args: {
    initial: {
      bookId: "shared-42",
      name: "Alice",
      mayShare: false,
      isSharee: true,
      shareWith: null,
    },
  },
  play: async () => {
    await expect(
      screen.getByRole("button", { name: defaultContactsLabels.removeSharedAddressBook }),
    ).toBeInTheDocument();
    await expect(screen.queryByText(defaultContactsLabels.shareAddressBookTitle)).toBeNull();
  },
};
