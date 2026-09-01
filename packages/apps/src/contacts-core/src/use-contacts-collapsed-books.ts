import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  expandCollapsedAddressBookId,
  getCollapsedAddressBookIds,
  subscribeContactsViewPrefs,
  toggleCollapsedAddressBookId,
} from "@/contacts-core/src/contacts-view-prefs";

const EMPTY_COLLAPSED: readonly string[] = [];

/** Device-local folded address books. Missing prefs = all expanded. */
export function useCollapsedAddressBookIds(activeGroupBookId?: string | null): {
  collapsedAddressBookIds: ReadonlySet<string>;
  toggleCollapsed: (bookId: string) => void;
} {
  const ids = useSyncExternalStore(
    subscribeContactsViewPrefs,
    getCollapsedAddressBookIds,
    () => EMPTY_COLLAPSED,
  );
  const collapsedAddressBookIds = useMemo(() => new Set(ids), [ids]);

  useEffect(() => {
    if (activeGroupBookId) expandCollapsedAddressBookId(activeGroupBookId);
  }, [activeGroupBookId]);

  return {
    collapsedAddressBookIds,
    toggleCollapsed: toggleCollapsedAddressBookId,
  };
}
