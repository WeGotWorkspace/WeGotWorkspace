import { useMemo } from "react";
import { Users } from "lucide-react";
import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import {
  isSharedAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";

type UseContactsSidebarModelArgs = {
  labels: ContactsUILabels;
  view: string;
  addressBooks: ContactsAddressBookRow[];
  selectView: (view: string) => void;
};

export function useContactsSidebarModel({
  labels,
  view,
  addressBooks,
  selectView,
}: UseContactsSidebarModelArgs) {
  const { owned: ownedAddressBooks, shared: sharedAddressBooks } = useMemo(
    () =>
      partitionOwnedAndShared(addressBooks, {
        isSharee: isSharedAddressBook,
      }),
    [addressBooks],
  );

  const primarySidebarItems = useMemo(
    () => [
      {
        label: labels.sidebarAllContacts,
        icon: <Users className="size-3.5" />,
        selected: view === "all",
        onClick: () => selectView("all"),
      },
    ],
    [labels.sidebarAllContacts, selectView, view],
  );

  return {
    primarySidebarItems,
    ownedAddressBooks,
    sharedAddressBooks,
  };
}
