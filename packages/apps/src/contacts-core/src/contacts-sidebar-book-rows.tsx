import { useMemo } from "react";
import { Eye } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import {
  addressBookDotColor,
  firstEnabledAddressBookId,
} from "@/contacts-core/src/contacts-addressbook-color";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import { useCollapsedAddressBookIds } from "@/contacts-core/src/use-contacts-collapsed-books";
import {
  ContactsSidebarGroupRows,
  type ContactsSidebarGroupRowsProps,
} from "@/contacts-core/src/contacts-sidebar-group-rows";
import {
  canOpenAddressBookSettings,
  contactsAddressBookDisplayName,
  contactsBookViewKey,
  isViewOnlyAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";
import {
  contactsGroupViewKey,
  groupsInAddressBook,
} from "@/contacts-core/src/contacts-group-utils";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

export type ContactsSidebarBookRowsProps = {
  books: ContactsAddressBookRow[];
  view: string;
  editLabel: string;
  viewOnlyLabel: string;
  personalLabel?: string;
  hiddenAddressBookIds: ReadonlySet<string>;
  onToggleVisibility: (bookId: string) => void;
  onSelect: (bookId: string) => void;
  onEdit: (book: ContactsAddressBookRow) => void;
  groups?: ContactCard[];
  groupEditLabel?: string;
  expandGroupsLabel?: (name: string) => string;
  collapseGroupsLabel?: (name: string) => string;
  canEditGroup?: (group: ContactCard) => boolean;
  onSelectGroup?: (groupId: string) => void;
  onEditGroup?: (group: ContactCard) => void;
  groupDropZoneProps?: ContactsSidebarGroupRowsProps["dropZoneProps"];
};

export function ContactsSidebarBookRows({
  books,
  view,
  editLabel,
  viewOnlyLabel,
  personalLabel = "Personal",
  hiddenAddressBookIds,
  onToggleVisibility,
  onSelect,
  onEdit,
  groups = [],
  groupEditLabel = "Rename group",
  expandGroupsLabel = (name) => `Expand ${name}`,
  collapseGroupsLabel = (name) => `Collapse ${name}`,
  canEditGroup = () => false,
  onSelectGroup = () => undefined,
  onEditGroup = () => undefined,
  groupDropZoneProps = () => ({}),
}: ContactsSidebarBookRowsProps) {
  const colorOverrides = useAddressBookColorOverrides();
  const selectedGroup = useMemo(
    () => groups.find((group) => view === contactsGroupViewKey(group.id)),
    [groups, view],
  );
  const activeGroupBookId = firstEnabledAddressBookId(selectedGroup?.addressBookIds);
  const { collapsedAddressBookIds, toggleCollapsed } =
    useCollapsedAddressBookIds(activeGroupBookId);

  return (
    <>
      {books.map((book) => {
        const viewOnly = isViewOnlyAddressBook(book);
        const name = contactsAddressBookDisplayName(book, personalLabel);
        const bookGroups = groupsInAddressBook(groups, book.id);
        const expanded = !collapsedAddressBookIds.has(book.id);
        const childSelected = bookGroups.some((group) => view === contactsGroupViewKey(group.id));
        return (
          <ContactsSidebarBookBlock
            key={book.id}
            name={name}
            color={addressBookDotColor(book, colorOverrides)}
            selected={view === contactsBookViewKey(book.id)}
            related={childSelected}
            visible={!hiddenAddressBookIds.has(book.id)}
            viewOnly={viewOnly}
            viewOnlyLabel={viewOnlyLabel}
            editLabel={editLabel}
            expanded={expanded}
            groups={bookGroups}
            view={view}
            groupEditLabel={groupEditLabel}
            expandLabel={expanded ? collapseGroupsLabel(name) : expandGroupsLabel(name)}
            canEditGroup={canEditGroup}
            onToggleVisibility={() => onToggleVisibility(book.id)}
            onSelect={() => onSelect(book.id)}
            onEdit={canOpenAddressBookSettings(book) ? () => onEdit(book) : undefined}
            onToggleExpand={bookGroups.length > 0 ? () => toggleCollapsed(book.id) : undefined}
            onSelectGroup={onSelectGroup}
            onEditGroup={onEditGroup}
            groupDropZoneProps={groupDropZoneProps}
          />
        );
      })}
    </>
  );
}

function ContactsSidebarBookBlock({
  name,
  color,
  selected,
  related,
  visible,
  viewOnly,
  viewOnlyLabel,
  editLabel,
  expanded,
  groups,
  view,
  groupEditLabel,
  expandLabel,
  canEditGroup,
  onToggleVisibility,
  onSelect,
  onEdit,
  onToggleExpand,
  onSelectGroup,
  onEditGroup,
  groupDropZoneProps,
}: {
  name: string;
  color: string;
  selected: boolean;
  related: boolean;
  visible: boolean;
  viewOnly: boolean;
  viewOnlyLabel: string;
  editLabel: string;
  expanded: boolean;
  groups: ContactCard[];
  view: string;
  groupEditLabel: string;
  expandLabel: string;
  canEditGroup: (group: ContactCard) => boolean;
  onToggleVisibility: () => void;
  onSelect: () => void;
  onEdit?: () => void;
  onToggleExpand?: () => void;
  onSelectGroup: (groupId: string) => void;
  onEditGroup: (group: ContactCard) => void;
  groupDropZoneProps: ContactsSidebarGroupRowsProps["dropZoneProps"];
}) {
  return (
    <>
      <CollectionSidebarRow
        name={name}
        color={color}
        selected={selected}
        related={related}
        visible={visible}
        expanded={expanded}
        onToggleVisibility={onToggleVisibility}
        onSelect={onSelect}
        onEdit={onEdit}
        onToggleExpand={onToggleExpand}
        editLabel={editLabel}
        expandLabel={expandLabel}
        badges={
          viewOnly ? (
            <CollectionSidebarMark label={viewOnlyLabel}>
              <Eye className="size-3.5" aria-hidden />
            </CollectionSidebarMark>
          ) : null
        }
      />
      {expanded && groups.length > 0 ? (
        <ContactsSidebarGroupRows
          nested
          groups={groups}
          view={view}
          editLabel={groupEditLabel}
          canEditGroup={canEditGroup}
          onSelect={onSelectGroup}
          onEdit={onEditGroup}
          dropZoneProps={groupDropZoneProps}
        />
      ) : null}
    </>
  );
}
