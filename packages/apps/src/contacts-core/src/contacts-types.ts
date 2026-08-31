import type {
  AddressBook,
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
} from "@wgw-api-generated/contacts-types";

export type { AddressBook, ContactCard, ContactCardCreate, ContactCardPatch };

export type ContactsUIData = {
  addressBooks: AddressBook[];
  cards: ContactCard[];
};

export type ContactCardImportError = {
  index: number;
  message: string;
};

export type ContactCardImportResponse = {
  list: ContactCard[];
  errors: ContactCardImportError[];
};

export type ContactsMutationOpts = {
  signal?: AbortSignal;
  /** JMAP ifInState token — preferred for Contact/set. */
  ifInState?: string;
  /** Legacy CardDAV etag — used when state is unavailable. */
  ifMatch?: string;
};

/**
 * Backend-agnostic contacts operations consumed by contacts UI/controller.
 * Implement this for any provider (WGW, custom API, local-only, etc).
 */
export type ContactsAPIOperations = {
  listAddressBooks: (opts?: { signal?: AbortSignal }) => Promise<AddressBook[]>;
  listCards: (opts?: { addressBookId?: string; signal?: AbortSignal }) => Promise<ContactCard[]>;
  getCard: (cardId: string, opts?: { signal?: AbortSignal }) => Promise<ContactCard>;
  createCard: (body: ContactCardCreate, opts?: { signal?: AbortSignal }) => Promise<ContactCard>;
  patchCard: (
    cardId: string,
    patch: ContactCardPatch,
    opts?: ContactsMutationOpts,
  ) => Promise<ContactCard>;
  deleteCard: (cardId: string, opts?: ContactsMutationOpts) => Promise<void>;
  /**
   * Fetch the raw vCard bytes (text/vcard) for a single card from the server.
   * When absent, the controller falls back to client-side conversion from JSContact.
   */
  downloadCardVcf?: (cardId: string, opts?: { signal?: AbortSignal }) => Promise<string>;
  /**
   * Import one or more vCard blocks from file text. Server converts vCard → JSContact
   * and creates contacts before groups so member uids resolve within the same file.
   */
  importVcards?: (
    vcardText: string,
    opts?: { addressBookId: string; signal?: AbortSignal },
  ) => Promise<ContactCardImportResponse>;
  /**
   * Patch shareWith / isSubscribed only. Optional so mock-tier / Chunk D can omit it.
   */
  patchAddressBook?: (
    addressBookId: string,
    patch: AddressBookMutationPatch,
    opts?: ContactsMutationOpts,
  ) => Promise<AddressBook>;
};

/** AddressBook/set fields the contacts client may enqueue (no rename/delete). */
export type AddressBookMutationPatch = {
  shareWith?: AddressBook["shareWith"];
  isSubscribed?: boolean;
};
