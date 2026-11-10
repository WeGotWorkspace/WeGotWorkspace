import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactsSidebarBookRows } from "@/contacts-core/src/contacts-sidebar-book-rows";
import { ContactsSidebarGroupRows } from "@/contacts-core/src/contacts-sidebar-group-rows";
import { contactDisplayName } from "@/contacts-core/src/contacts-display-utils";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { sortOwnedSidebarAddressBooks } from "@/contacts-core/src/use-contacts-sidebar-model";
import type { ContactCard } from "@/lib/models/contacts-types";
import { CONTACTS_VIEW_PREFS_STORAGE_KEY } from "@/contacts-core/src/contacts-view-prefs";
import { ContactsStoryScope } from "./contacts-story-scope";

const ownerBook: ContactsAddressBookRow = {
  id: "default",
  name: "Zoe",
  description: null,
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

const alphaBook: ContactsAddressBookRow = {
  id: "group-alpha",
  name: "Alpha",
  description: null,
  sortOrder: 1,
  isDefault: false,
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

const friendsGroup = {
  "@type": "Card",
  version: "1.0",
  id: "group-friends",
  uid: "urn:uuid:group-friends",
  kind: "group",
  name: { full: "Friends" },
  addressBookIds: { default: true },
} as unknown as ContactCard;

const standupsGroup = {
  "@type": "Card",
  version: "1.0",
  id: "group-standups",
  uid: "urn:uuid:group-standups",
  kind: "group",
  name: { full: "Standups" },
  addressBookIds: { "group-eng": true },
} as unknown as ContactCard;

const aliceColleagues = {
  "@type": "Card",
  version: "1.0",
  id: "group-alice-colleagues",
  uid: "urn:uuid:group-alice-colleagues",
  kind: "group",
  name: { full: "Colleagues" },
  addressBookIds: { "shared-42": true },
} as unknown as ContactCard;

const viewOnlySharee: ContactsAddressBookRow = {
  id: "shared-42",
  name: "Alice",
  description: null,
  sortOrder: 2,
  isDefault: false,
  isSubscribed: true,
  isSharee: true,
  shareWith: null,
  myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
};

// Groups get their own section in name order, like the workspace sidebar.
const sidebarGroups = [friendsGroup, standupsGroup, aliceColleagues].sort((a, b) =>
  contactDisplayName(a).localeCompare(contactDisplayName(b), undefined, { sensitivity: "base" }),
);
const ownedSidebarBooks = sortOwnedSidebarAddressBooks([teamBook, alphaBook, ownerBook]);

function ContactsSidebarHarness({
  view = "all",
  onSelect = fn(),
  onEdit = fn(),
  onSelectGroup = fn(),
  onEditGroup = fn(),
  onToggleVisibility = fn(),
  hiddenAddressBookIds = [],
}: {
  view?: string;
  onSelect?: (bookId: string) => void;
  onEdit?: (book: ContactsAddressBookRow) => void;
  onSelectGroup?: (groupId: string) => void;
  onEditGroup?: (group: ContactCard) => void;
  onToggleVisibility?: (bookId: string) => void;
  hiddenAddressBookIds?: string[];
}) {
  useState(() => {
    window.localStorage.removeItem(CONTACTS_VIEW_PREFS_STORAGE_KEY);
    return true;
  });
  return (
    <ContactsStoryScope>
      <TooltipProvider delayDuration={0}>
        <div className="app-sidebar__scroll max-w-xs p-4">
          <SidebarSection title={defaultContactsLabels.sectionAddressBooks}>
            <ContactsSidebarBookRows
              books={ownedSidebarBooks}
              view={view}
              editLabel={defaultContactsLabels.editAddressBook}
              viewOnlyLabel={defaultContactsLabels.viewOnly}
              personalLabel={defaultContactsLabels.personalAddressBook}
              hiddenAddressBookIds={new Set(hiddenAddressBookIds)}
              onToggleVisibility={onToggleVisibility}
              onSelect={onSelect}
              onEdit={onEdit}
            />
          </SidebarSection>
          <SidebarSection title={defaultContactsLabels.sidebarSharedWithMe}>
            <ContactsSidebarBookRows
              books={[viewOnlySharee]}
              view={view}
              editLabel={defaultContactsLabels.editAddressBook}
              viewOnlyLabel={defaultContactsLabels.viewOnly}
              personalLabel={defaultContactsLabels.personalAddressBook}
              hiddenAddressBookIds={new Set(hiddenAddressBookIds)}
              onToggleVisibility={onToggleVisibility}
              onSelect={onSelect}
              onEdit={onEdit}
            />
          </SidebarSection>
          <SidebarSection title={defaultContactsLabels.sectionGroups}>
            <ContactsSidebarGroupRows
              groups={sidebarGroups}
              view={view}
              editLabel={defaultContactsLabels.renameGroup}
              canEditGroup={() => true}
              onSelect={onSelectGroup}
              onEdit={onEditGroup}
              dropZoneProps={() => ({ isDropTarget: false })}
            />
          </SidebarSection>
        </div>
      </TooltipProvider>
    </ContactsStoryScope>
  );
}

const meta: Meta<typeof ContactsSidebarHarness> = {
  title: "Features/Contacts/Sidebar",
  component: ContactsSidebarHarness,
  args: {
    view: "all",
    onSelect: fn(),
    onEdit: fn(),
    onSelectGroup: fn(),
    onEditGroup: fn(),
    onToggleVisibility: fn(),
    hiddenAddressBookIds: [],
  },
};

export default meta;
type Story = StoryObj<typeof ContactsSidebarHarness>;

export const OwnedAndShared: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(defaultContactsLabels.sectionAddressBooks)).toBeInTheDocument();
    await expect(canvas.getByText(defaultContactsLabels.sidebarSharedWithMe)).toBeInTheDocument();
    await expect(canvas.getByText(defaultContactsLabels.sectionGroups)).toBeInTheDocument();
    const personal = canvas.getByRole("button", { name: "Personal" });
    const alpha = canvas.getByRole("button", { name: "Alpha" });
    const engineering = canvas.getByRole("button", { name: "Engineering" });
    await expect(personal.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await expect(
      alpha.compareDocumentPosition(engineering) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(canvas.getByRole("button", { name: "Friends" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Standups" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Colleagues" })).toBeInTheDocument();
    // Groups are a flat section of their own: no fold under an address book.
    await expect(canvas.queryByRole("button", { name: /^(Collapse|Expand) / })).toBeNull();
    await expect(canvas.getByRole("checkbox", { name: "Hide Personal" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("checkbox", { name: "Hide Personal" }));
    await expect(args.onToggleVisibility).toHaveBeenCalledWith("default");
    await userEvent.click(canvas.getByRole("button", { name: "Personal" }));
    await expect(args.onSelect).toHaveBeenCalledWith("default");
    await expect(
      canvas.getByRole("img", { name: defaultContactsLabels.viewOnly }),
    ).toBeInTheDocument();
    await userEvent.click(
      canvas.getAllByRole("button", { name: defaultContactsLabels.editAddressBook })[0]!,
    );
    await expect(args.onEdit).toHaveBeenCalled();
  },
};

export const ViewOnlyEyeMark: Story = {
  args: {
    view: "book:shared-42",
  },
};

export const GroupsSection: Story = {
  tags: ["vitest-ci"],
  args: {
    view: "group:group-friends",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const groupsTitle = canvas.getByText(defaultContactsLabels.sectionGroups);
    await expect(groupsTitle).toBeInTheDocument();
    const friends = canvas.getByRole("button", { name: "Friends" });
    const colleagues = canvas.getByRole("button", { name: "Colleagues" });
    const standups = canvas.getByRole("button", { name: "Standups" });
    // In name order, all below the Groups title, after every address book.
    await expect(
      colleagues.compareDocumentPosition(friends) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(friends.compareDocumentPosition(standups) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await expect(
      // "Alice View only": the shared book's name carries its view-only badge.
      canvas.getByRole("button", { name: /^Alice\b/ }).compareDocumentPosition(colleagues) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(friends.closest(".collection-sidebar-row")).toHaveClass(
      "collection-sidebar-row--selected",
    );
    // Each group icon wears its address book's colour.
    const icon = friends
      .closest(".collection-sidebar-row")
      ?.querySelector<HTMLElement>(".contacts-group-icon");
    await expect(icon?.style.getPropertyValue("--collection-row-color")).not.toBe("");
    await expect(canvas.queryByRole("button", { name: /^(Collapse|Expand) / })).toBeNull();
    await userEvent.click(
      canvas.getAllByRole("button", { name: defaultContactsLabels.renameGroup })[0]!,
    );
    await expect(args.onEditGroup).toHaveBeenCalled();
    await userEvent.click(friends);
    await expect(args.onSelectGroup).toHaveBeenCalledWith("group-friends");
  },
};
