import type { HTMLAttributes } from "react";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import { groupAddressBookColor } from "@/contacts-core/src/contacts-addressbook-color";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import { contactDisplayName } from "@/contacts-core/src/contacts-display-utils";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import { contactsGroupViewKey } from "@/contacts-core/src/contacts-group-utils";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

export type ContactsSidebarGroupRowsProps = {
  groups: ContactCard[];
  view: string;
  editLabel: string;
  nested?: boolean;
  canEditGroup: (group: ContactCard) => boolean;
  onSelect: (groupId: string) => void;
  onEdit: (group: ContactCard) => void;
  dropZoneProps: (groupId: string) => {
    isDropTarget?: boolean;
  } & Record<string, unknown>;
};

export function ContactsSidebarGroupRows({
  groups,
  view,
  editLabel,
  nested = false,
  canEditGroup,
  onSelect,
  onEdit,
  dropZoneProps,
}: ContactsSidebarGroupRowsProps) {
  const colorOverrides = useAddressBookColorOverrides();
  return (
    <>
      {groups.map((group) => {
        const { isDropTarget, ...dropHandlers } = dropZoneProps(group.id);
        return (
          <CollectionSidebarRow
            key={group.id}
            name={contactDisplayName(group)}
            color={groupAddressBookColor(group, colorOverrides) ?? ""}
            nested={nested}
            selected={view === contactsGroupViewKey(group.id)}
            onSelect={() => onSelect(group.id)}
            onEdit={canEditGroup(group) ? () => onEdit(group) : undefined}
            editLabel={editLabel}
            leading={<ContactsGroupIcon book={group} />}
            rootProps={{
              ...(dropHandlers as HTMLAttributes<HTMLLIElement>),
              className: isDropTarget ? "collection-sidebar-row--drop-target" : undefined,
            }}
          />
        );
      })}
    </>
  );
}
