import type { JmapId } from "../core/types.js";

/** AddressBookRights (RFC 9610 §2). */
export type JmapAddressBookRights = {
  mayRead: boolean;
  mayWrite: boolean;
  mayShare: boolean;
  mayDelete: boolean;
  [key: string]: unknown;
};

/** AddressBook object (RFC 9610 §2). */
export type JmapAddressBook = {
  id: JmapId;
  name: string;
  description?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
  isSubscribed?: boolean;
  shareWith?: Record<JmapId, JmapAddressBookRights> | null;
  isSharee?: boolean;
  myRights?: JmapAddressBookRights;
  [key: string]: unknown;
};

/**
 * ContactCard = JSContact Card + JMAP additions (RFC 9610 §2.1).
 * Extra JSContact properties pass through the index signature.
 */
export type JmapContactCard = {
  id: JmapId;
  addressBookIds?: Record<JmapId, boolean>;
  state?: string;
  [key: string]: unknown;
};

/**
 * ContactCard/query FilterCondition — the filters the envelope accepts:
 * `inAddressBook`, `uid` and `kind` (the Contacts list asks for `group`).
 */
export type JmapContactCardFilterCondition = {
  inAddressBook?: JmapId;
  uid?: string;
  kind?: string;
};
