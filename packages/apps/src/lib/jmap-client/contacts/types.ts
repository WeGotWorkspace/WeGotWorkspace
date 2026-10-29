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

/** RFC 9553 card kinds; the server's `kind` filter accepts these. */
export type JmapContactCardKind =
  "individual" | "group" | "org" | "location" | "device" | "application";

/**
 * ContactCard/query FilterCondition — only the filters the envelope accepts
 * (`inAddressBook`, `uid`, `kind`). Other RFC 9610 keys get `unsupportedFilter`.
 */
export type JmapContactCardFilterCondition = {
  inAddressBook?: JmapId;
  uid?: string;
  kind?: JmapContactCardKind;
};
