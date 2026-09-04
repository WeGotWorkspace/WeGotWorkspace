import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import {
  ContactsImportDialog,
  contactsImportDialogLabelsFrom,
} from "@/contacts-core/src/contacts-import-dialog";
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

const sampleFiles = [new File(["BEGIN:VCARD\nFN:One\nEND:VCARD"], "one.vcf")];

function ContactsImportDialogHarness({
  view = "all",
  onImport = fn(),
}: {
  view?: string;
  onImport?: (files: File[], addressBookId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ContactsStoryScope>
      <ContactsImportDialog
        open={open}
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view={view}
        labels={contactsImportDialogLabelsFrom(defaultContactsLabels)}
        onClose={() => setOpen(false)}
        onImport={(files, addressBookId) => {
          onImport(files, addressBookId);
          setOpen(false);
        }}
      />
    </ContactsStoryScope>
  );
}

const meta: Meta<typeof ContactsImportDialogHarness> = {
  title: "Apps/Contacts/Import dialog",
  component: ContactsImportDialogHarness,
  args: {
    view: "all",
    onImport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ContactsImportDialogHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ args }) => {
    await expect(screen.getByText(defaultContactsLabels.importDialogTitle)).toBeInTheDocument();
    await expect(
      screen.getByLabelText(defaultContactsLabels.importDestinationLegend),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: defaultContactsLabels.importSubmit }));
    await expect(args.onImport).toHaveBeenCalledWith(sampleFiles, "default");
  },
};

export const TeamBookInView: Story = {
  args: {
    view: "book:group-eng",
  },
};

export const ErrorOverflow: Story = {
  render: () => (
    <ContactsStoryScope>
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view="all"
        labels={contactsImportDialogLabelsFrom(defaultContactsLabels)}
        error="Upload too large. Current server post_max_size is 8M. http://localhost:5174/api/v1/contacts/cards/import?addressBookId=group-administrators"
        onClose={() => undefined}
        onImport={() => undefined}
      />
    </ContactsStoryScope>
  ),
};

export const Importing: Story = {
  render: () => (
    <ContactsStoryScope>
      <ContactsImportDialog
        open
        files={sampleFiles}
        books={[ownerBook, teamBook]}
        view="all"
        labels={contactsImportDialogLabelsFrom(defaultContactsLabels)}
        busy
        progress={{ importedCards: 40, totalCards: 200, batchIndex: 2, batchCount: 4 }}
        onClose={() => undefined}
        onImport={() => undefined}
      />
    </ContactsStoryScope>
  ),
};
