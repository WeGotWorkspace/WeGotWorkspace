import { createViewPrefsStore, viewPrefsField } from "@/lib/view-prefs-store";

export const CONTACTS_VIEW_PREFS_STORAGE_KEY = "wgw.ui.contacts.viewPrefs";

export type ContactsViewPrefs = {
  hiddenAddressBookIds?: string[];
  knownAddressBookIds?: string[];
  /** Books whose sidebar groups are folded. Missing / empty = all expanded. */
  collapsedAddressBookIds?: string[];
};

export const contactsViewPrefs = createViewPrefsStore<ContactsViewPrefs>(
  CONTACTS_VIEW_PREFS_STORAGE_KEY,
  {
    hiddenAddressBookIds: viewPrefsField.idList,
    knownAddressBookIds: viewPrefsField.idList,
    collapsedAddressBookIds: viewPrefsField.idList,
  },
);

export const contactsHiddenAddressBooks = contactsViewPrefs.hiddenCollection(
  "hiddenAddressBookIds",
  "knownAddressBookIds",
);
