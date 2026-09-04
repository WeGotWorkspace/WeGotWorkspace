import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactsSidebarBookRows } from "@/contacts-core/src/contacts-sidebar-book-rows";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import { sortOwnedSidebarAddressBooks } from "@/contacts-core/src/use-contacts-sidebar-model";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
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

const sidebarGroups = [friendsGroup, standupsGroup, aliceColleagues];
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
  const groupRowProps = {
    groups: sidebarGroups,
    groupEditLabel: defaultContactsLabels.renameGroup,
    expandGroupsLabel: defaultContactsLabels.expandAddressBookGroups,
    collapseGroupsLabel: defaultContactsLabels.collapseAddressBookGroups,
    canEditGroup: () => true,
    onSelectGroup,
    onEditGroup,
    groupDropZoneProps: () => ({ isDropTarget: false }),
  };
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
              {...groupRowProps}
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
              {...groupRowProps}
            />
          </SidebarSection>
        </div>
      </TooltipProvider>
    </ContactsStoryScope>
  );
}

const meta: Meta<typeof ContactsSidebarHarness> = {
  title: "Apps/Contacts/Sidebar",
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
    await expect(canvas.queryByText(defaultContactsLabels.sectionGroups)).toBeNull();
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
    await expect(canvas.getByRole("button", { name: "Collapse Alice" })).toBeInTheDocument();
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

export const GroupsUnderBooks: Story = {
  tags: ["vitest-ci"],
  args: {
    view: "group:group-friends",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(defaultContactsLabels.sectionGroups)).toBeNull();
    await expect(canvas.getByRole("button", { name: "Friends" })).toBeInTheDocument();
    await userEvent.click(
      canvas.getAllByRole("button", { name: defaultContactsLabels.renameGroup })[0]!,
    );
    await expect(args.onEditGroup).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Friends" }));
    await expect(args.onSelectGroup).toHaveBeenCalledWith("group-friends");
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Personal" }));
    await expect(canvas.queryByRole("button", { name: "Friends" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Expand Personal" }));
    await expect(canvas.getByRole("button", { name: "Friends" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Alice" }));
    await expect(canvas.queryByRole("button", { name: "Colleagues" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Expand Alice" }));
    await expect(canvas.getByRole("button", { name: "Colleagues" })).toBeInTheDocument();
  },
};
