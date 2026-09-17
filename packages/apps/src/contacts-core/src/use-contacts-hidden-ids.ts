import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import {
  persistHiddenAddressBookIds,
  readContactsViewPrefs,
} from "@/contacts-core/src/contacts-view-prefs";

/** Device-local hidden address-book set. Same localStorage algorithm as Notes/Tasks/Calendar. */
export function useContactsHiddenIds(books: ReadonlyArray<{ id: string }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(books, {
    read: () => {
      const prefs = readContactsViewPrefs();
      if (!prefs) return null;
      return { hiddenIds: prefs.hiddenAddressBookIds, knownIds: prefs.knownAddressBookIds };
    },
    write: persistHiddenAddressBookIds,
  });
  return { hiddenAddressBookIds: hiddenIds, setHiddenAddressBookIds: setHiddenIds };
}
