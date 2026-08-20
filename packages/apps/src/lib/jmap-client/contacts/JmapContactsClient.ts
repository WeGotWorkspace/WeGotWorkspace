import { JmapSetItemError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { CONTACTS_CAPABILITY, CORE_CAPABILITY } from "../core/types.js";
import type {
  ChangesResponse,
  GetResponse,
  JmapId,
  JmapState,
  QueryResponse,
  SetArgs,
  SetResponse,
} from "../core/types.js";
import type { JmapAddressBook, JmapContactCard, JmapContactCardFilterCondition } from "./types.js";

const ADDRESS_BOOK_TYPE = "AddressBook";
const CONTACT_CARD_TYPE = "ContactCard";

export const CONTACTS_USING = [CORE_CAPABILITY, CONTACTS_CAPABILITY];

function assertSetSucceeded<T>(response: SetResponse<T>): void {
  const notCreated = Object.entries(response.notCreated ?? {});
  if (notCreated.length) throw new JmapSetItemError("create", notCreated[0][0], notCreated[0][1]);
  const notUpdated = Object.entries(response.notUpdated ?? {});
  if (notUpdated.length) throw new JmapSetItemError("update", notUpdated[0][0], notUpdated[0][1]);
  const notDestroyed = Object.entries(response.notDestroyed ?? {});
  if (notDestroyed.length)
    throw new JmapSetItemError("destroy", notDestroyed[0][0], notDestroyed[0][1]);
}

/**
 * Typed AddressBook / ContactCard methods (RFC 9610) over {@link JmapClient}.
 * `using` is always core + contacts so a calendars-default request cannot
 * mark these methods unknownMethod.
 */
export class JmapContactsClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  // ---- AddressBook ----

  async getAddressBooks(
    accountId: JmapId,
    ids?: JmapId[] | null,
  ): Promise<GetResponse<JmapAddressBook>> {
    const response = await this.client.call<GetResponse<JmapAddressBook>>(
      "AddressBook/get",
      { accountId, ids: ids ?? null },
      CONTACTS_USING,
    );
    this.client.setState(accountId, ADDRESS_BOOK_TYPE, response.state);
    return response;
  }

  async addressBookChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>(
      "AddressBook/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      CONTACTS_USING,
    );
    this.client.setState(accountId, ADDRESS_BOOK_TYPE, response.newState);
    return response;
  }

  async setAddressBooks(
    args: Omit<SetArgs<JmapAddressBook>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapAddressBook>> {
    const response = await this.client.call<SetResponse<JmapAddressBook>>(
      "AddressBook/set",
      args,
      CONTACTS_USING,
    );
    this.client.setState(args.accountId, ADDRESS_BOOK_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }

  // ---- ContactCard ----

  async getContactCards(
    accountId: JmapId,
    ids?: JmapId[] | null,
    properties?: string[] | null,
  ): Promise<GetResponse<JmapContactCard>> {
    const response = await this.client.call<GetResponse<JmapContactCard>>(
      "ContactCard/get",
      {
        accountId,
        ids: ids ?? null,
        ...(properties !== undefined ? { properties } : {}),
      },
      CONTACTS_USING,
    );
    this.client.setState(accountId, CONTACT_CARD_TYPE, response.state);
    return response;
  }

  async contactCardChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>(
      "ContactCard/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      CONTACTS_USING,
    );
    this.client.setState(accountId, CONTACT_CARD_TYPE, response.newState);
    return response;
  }

  /**
   * ContactCard/set without throwing on per-record not*. Outbox flush and
   * patch/delete helpers need those maps (stateMismatch).
   */
  async setContactCards(
    args: Omit<SetArgs<Omit<JmapContactCard, "id">>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapContactCard>> {
    const response = await this.client.call<SetResponse<JmapContactCard>>(
      "ContactCard/set",
      args,
      CONTACTS_USING,
    );
    this.client.setState(args.accountId, CONTACT_CARD_TYPE, response.newState);
    return response;
  }

  async queryContactCards(
    accountId: JmapId,
    filter?: JmapContactCardFilterCondition | null,
    options: { position?: number; limit?: number; calculateTotal?: boolean } = {},
  ): Promise<QueryResponse> {
    return this.client.call<QueryResponse>(
      "ContactCard/query",
      {
        accountId,
        ...(filter ? { filter } : {}),
        ...options,
      },
      CONTACTS_USING,
    );
  }

  /**
   * Batched `ContactCard/query` → `ContactCard/get` wired with `#ids`
   * ResultReference — the sequence pinned in JmapContactsClientContractTest.
   */
  async getContactCardsByQuery(
    accountId: JmapId,
    filter?: JmapContactCardFilterCondition | null,
  ): Promise<GetResponse<JmapContactCard>> {
    const queryCallId = this.client.nextCallId();
    const getCallId = this.client.nextCallId();
    const queryArgs: Record<string, unknown> = { accountId };
    if (filter) queryArgs.filter = filter;
    const response = await this.client.request(
      [
        ["ContactCard/query", queryArgs, queryCallId],
        [
          "ContactCard/get",
          {
            accountId,
            "#ids": {
              resultOf: queryCallId,
              name: "ContactCard/query",
              path: "/ids",
            },
          },
          getCallId,
        ],
      ],
      CONTACTS_USING,
    );
    const getInvocation = response.methodResponses.find(
      ([name, , id]) => id === getCallId && name === "ContactCard/get",
    );
    if (!getInvocation) {
      const errorInvocation = response.methodResponses.find(([name]) => name === "error");
      const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
      throw new Error(`ContactCard query+get failed: ${detail}`);
    }
    const getResponse = getInvocation[1] as unknown as GetResponse<JmapContactCard>;
    this.client.setState(accountId, CONTACT_CARD_TYPE, getResponse.state);
    return getResponse;
  }

  /**
   * Initial sync batch pinned in JmapContactsClientContractTest: AddressBook/get
   * + ContactCard/get with `ids: null` in one request.
   */
  async getAddressBooksAndCards(accountId: JmapId): Promise<{
    books: GetResponse<JmapAddressBook>;
    cards: GetResponse<JmapContactCard>;
  }> {
    const booksCallId = this.client.nextCallId();
    const cardsCallId = this.client.nextCallId();
    const response = await this.client.request(
      [
        ["AddressBook/get", { accountId, ids: null }, booksCallId],
        ["ContactCard/get", { accountId, ids: null }, cardsCallId],
      ],
      CONTACTS_USING,
    );
    const booksInvocation = response.methodResponses.find(
      ([name, , id]) => id === booksCallId && name === "AddressBook/get",
    );
    const cardsInvocation = response.methodResponses.find(
      ([name, , id]) => id === cardsCallId && name === "ContactCard/get",
    );
    if (!booksInvocation || !cardsInvocation) {
      const errorInvocation = response.methodResponses.find(([name]) => name === "error");
      const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
      throw new Error(`Contacts initial sync failed: ${detail}`);
    }
    const books = booksInvocation[1] as unknown as GetResponse<JmapAddressBook>;
    const cards = cardsInvocation[1] as unknown as GetResponse<JmapContactCard>;
    this.client.setState(accountId, ADDRESS_BOOK_TYPE, books.state);
    this.client.setState(accountId, CONTACT_CARD_TYPE, cards.state);
    return { books, cards };
  }
}
