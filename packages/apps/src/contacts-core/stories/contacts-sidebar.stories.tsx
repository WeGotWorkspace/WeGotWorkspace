import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { TooltipProvider } from "@/ui/tooltip";
import { ContactsSidebarBookRows } from "@/contacts-core/src/contacts-sidebar-book-rows";
import { ContactsSidebarGroupRows } from "@/contacts-core/src/contacts-sidebar-group-rows";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
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

const friendsGroup = {
  "@type": "Card",
  version: "1.0",
  id: "group-friends",
  uid: "urn:uuid:group-friends",
  kind: "group",
  name: { full: "Friends" },
  addressBookIds: { default: true },
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
  return (
    <ContactsStoryScope>
      <TooltipProvider delayDuration={0}>
        <div className="app-sidebar__scroll max-w-xs p-4">
          <SidebarSection title={defaultContactsLabels.sectionAddressBooks}>
            <ContactsSidebarBookRows
              books={[ownerBook, teamBook]}
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
              groups={[friendsGroup]}
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
    await expect(canvas.getByRole("button", { name: "Personal" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Engineering" })).toBeInTheDocument();
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

export const GroupsWithEdit: Story = {
  tags: ["vitest-ci"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(defaultContactsLabels.sectionGroups)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Friends" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: defaultContactsLabels.renameGroup }));
    await expect(args.onEditGroup).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Friends" }));
    await expect(args.onSelectGroup).toHaveBeenCalledWith("group-friends");
  },
};
