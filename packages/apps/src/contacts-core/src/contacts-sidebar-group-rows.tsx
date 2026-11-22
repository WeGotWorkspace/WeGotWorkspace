import type { HTMLAttributes } from "react";
import { CollectionSidebarRow } from "@/collection-sidebar/src/collection-sidebar-row";
import { contactDisplayName } from "@/lib/models/contacts-display";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import { contactsGroupViewKey } from "@/contacts-core/src/contacts-group-utils";
import type { ContactCard } from "@/lib/models/contacts-types";

export type ContactsSidebarGroupRowsProps = {
  groups: ContactCard[];
  view: string;
  editLabel: string;
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
  canEditGroup,
  onSelect,
  onEdit,
  dropZoneProps,
}: ContactsSidebarGroupRowsProps) {
  return (
    <>
      {groups.map((group) => {
        const { isDropTarget, ...dropHandlers } = dropZoneProps(group.id);
        return (
          <CollectionSidebarRow
            key={group.id}
            name={contactDisplayName(group)}
            color=""
            selected={view === contactsGroupViewKey(group.id)}
            onSelect={() => onSelect(group.id)}
            onEdit={canEditGroup(group) ? () => onEdit(group) : undefined}
            editLabel={editLabel}
            leading={<ContactsGroupIcon />}
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
