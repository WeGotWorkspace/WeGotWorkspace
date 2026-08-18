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
 * ContactCard/query FilterCondition — only the filters the envelope already
 * accepts (`inAddressBook`, `uid`). Do not add `kind` or other RFC keys here.
 */
export type JmapContactCardFilterCondition = {
  inAddressBook?: JmapId;
  uid?: string;
};
