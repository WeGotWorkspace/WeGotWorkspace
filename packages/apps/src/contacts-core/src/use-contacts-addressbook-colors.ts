import { useSyncExternalStore } from "react";
import {
  getAddressBookColorOverrides,
  subscribeContactsViewPrefs,
} from "@/contacts-core/src/contacts-view-prefs";

const EMPTY_COLORS: Record<string, string> = {};

/** Device-local address-book color overrides. Re-renders when viewPrefs change. */
export function useAddressBookColorOverrides(): Record<string, string> {
  return useSyncExternalStore(
    subscribeContactsViewPrefs,
    getAddressBookColorOverrides,
    () => EMPTY_COLORS,
  );
}
