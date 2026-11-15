import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { contactsHiddenAddressBooks } from "@/contacts-core/src/contacts-view-prefs";

/** Device-local hidden address-book set. Same localStorage algorithm as Notes/Tasks/Calendar. */
export function useContactsHiddenIds(books: ReadonlyArray<{ id: string }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(books, contactsHiddenAddressBooks);
  return { hiddenAddressBookIds: hiddenIds, setHiddenAddressBookIds: setHiddenIds };
}
