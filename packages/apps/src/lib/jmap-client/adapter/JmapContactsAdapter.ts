import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { CONTACTS_CAPABILITY, type JmapId } from "../core/types.js";
import { JmapContactsClient } from "../contacts/JmapContactsClient.js";
import type { JmapAddressBook, JmapContactCard } from "../contacts/types.js";

const ADDRESS_BOOK_TYPE = "AddressBook";
const CONTACT_CARD_TYPE = "ContactCard";

export type JmapContactsAdapterOptions = {
  client: JmapClient;
  accountId?: JmapId;
  onSyncError?: (error: unknown) => void;
  onRemoteContactCard?: (card: JmapContactCard) => void;
  onRemoteContactCardDestroyed?: (cardId: JmapId) => void;
  onRemoteAddressBook?: (book: JmapAddressBook) => void;
  onRemoteAddressBookDestroyed?: (bookId: JmapId) => void;
  onRefetchAll?: (snapshot: { books: JmapAddressBook[]; cards: JmapContactCard[] }) => void;
};

/**
 * Inbound-only JMAP adapter: AddressBook then ContactCard `/changes` polling.
 * Mutations stay on the Dexie-first contacts operations / outbox.
 */
export class JmapContactsAdapter {
  #contacts: JmapContactsClient;
  #options: JmapContactsAdapterOptions;
  #accountId: JmapId | null = null;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #pollInFlight = false;

  constructor(options: JmapContactsAdapterOptions) {
    this.#options = options;
    this.#contacts = new JmapContactsClient(options.client);
  }

  get accountId(): JmapId {
    if (this.#accountId) return this.#accountId;
    this.#accountId =
      this.#options.accountId ?? this.#options.client.primaryAccountId(CONTACTS_CAPABILITY);
    return this.#accountId;
  }

  async initialize(): Promise<void> {
    if (!this.#options.client.isConnected) await this.#options.client.connect();
    // Empty ids: record envelope state without re-listing every body.
    await this.#contacts.getAddressBooks(this.accountId, []);
    await this.#contacts.getContactCards(this.accountId, []);
  }

  async sync(): Promise<void> {
    const client = this.#options.client;
    try {
      await this.#syncAddressBooks();

      const cardState = client.getState(this.accountId, CONTACT_CARD_TYPE);
      if (cardState) {
        const changes = await this.#contacts.contactCardChanges(this.accountId, cardState);
        const created = new Set(changes.created);
        const updated = changes.updated.filter((id) => !created.has(id));
        const changedIds = [...changes.created, ...updated];
        const destroyed = changes.destroyed.filter(
          (id) => !created.has(id) && !updated.includes(id),
        );
        if (changedIds.length) {
          const fetched = await this.#contacts.getContactCards(this.accountId, changedIds);
          for (const card of fetched.list) {
            this.#options.onRemoteContactCard?.(card);
          }
        }
        for (const id of destroyed) {
          this.#options.onRemoteContactCardDestroyed?.(id);
        }
      }
    } catch (error) {
      if (error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges") {
        await this.#refetchAll();
        return;
      }
      this.#options.onSyncError?.(error);
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.#pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (this.#pollInFlight) return;
      this.#pollInFlight = true;
      void this.sync().finally(() => {
        this.#pollInFlight = false;
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  async #syncAddressBooks(): Promise<void> {
    const bookState = this.#options.client.getState(this.accountId, ADDRESS_BOOK_TYPE);
    if (!bookState) return;
    const changes = await this.#contacts.addressBookChanges(this.accountId, bookState);
    const changedIds = [...changes.created, ...changes.updated];
    if (changedIds.length) {
      const fetched = await this.#contacts.getAddressBooks(this.accountId, changedIds);
      for (const book of fetched.list) {
        this.#options.onRemoteAddressBook?.(book);
      }
    }
    for (const bookId of changes.created) {
      const cards = await this.#contacts.getContactCardsByQuery(this.accountId, {
        inAddressBook: bookId,
      });
      for (const card of cards.list) {
        this.#options.onRemoteContactCard?.(card);
      }
    }
    for (const id of changes.destroyed) {
      this.#options.onRemoteAddressBookDestroyed?.(id);
    }
  }

  async #refetchAll(): Promise<void> {
    const books = await this.#contacts.getAddressBooks(this.accountId);
    const cards = await this.#contacts.getContactCards(this.accountId);
    if (this.#options.onRefetchAll) {
      this.#options.onRefetchAll({ books: books.list, cards: cards.list });
      return;
    }
    for (const book of books.list) {
      this.#options.onRemoteAddressBook?.(book);
    }
    for (const card of cards.list) {
      this.#options.onRemoteContactCard?.(card);
    }
  }
}
