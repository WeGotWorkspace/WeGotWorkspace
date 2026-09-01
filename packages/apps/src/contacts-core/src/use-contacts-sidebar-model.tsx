import { useMemo } from "react";
import { Users } from "lucide-react";
import {
  partitionOwnedAndShared,
  sortCollectionsByName,
} from "@/collection-sidebar/src/collection-sidebar-partition";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import {
  isPersonalAddressBook,
  isSharedAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";

/** Personal `default` first; remaining owned books A–Z by server name. */
export function sortOwnedSidebarAddressBooks(
  books: readonly ContactsAddressBookRow[],
): ContactsAddressBookRow[] {
  const personal: ContactsAddressBookRow[] = [];
  const rest: ContactsAddressBookRow[] = [];
  for (const book of books) {
    if (isPersonalAddressBook(book)) personal.push(book);
    else rest.push(book);
  }
  return [...personal, ...sortCollectionsByName(rest)];
}

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
  const { owned: ownedAddressBooks, shared: sharedAddressBooks } = useMemo(() => {
    const partitioned = partitionOwnedAndShared(addressBooks, {
      isSharee: isSharedAddressBook,
    });
    return {
      owned: sortOwnedSidebarAddressBooks(partitioned.owned),
      shared: partitioned.shared,
    };
  }, [addressBooks]);

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
