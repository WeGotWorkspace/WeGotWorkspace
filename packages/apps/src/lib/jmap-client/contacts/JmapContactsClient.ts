import { JmapMethodError, JmapSetItemError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { CONTACTS_CAPABILITY, CORE_CAPABILITY } from "../core/types.js";
import type {
  ChangesResponse,
  GetResponse,
  JmapId,
  JmapInvocation,
  JmapMethodErrorArgs,
  JmapState,
  QueryResponse,
  SetArgs,
  SetResponse,
} from "../core/types.js";
import type { JmapAddressBook, JmapContactCard, JmapContactCardFilterCondition } from "./types.js";

const ADDRESS_BOOK_TYPE = "AddressBook";
const CONTACT_CARD_TYPE = "ContactCard";
const DEFAULT_MAX_OBJECTS_IN_GET = 500;
const DEFAULT_MAX_CALLS_IN_REQUEST = 32;

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
    const resolvedIds =
      ids === undefined || ids === null ? (await this.queryContactCards(accountId)).ids : ids;
    return this.#getContactCardsByIds(accountId, resolvedIds, properties);
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
   * When the query is larger than maxObjectsInGet, falls back to explicit
   * id pages instead of a get-all.
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
    const queryInvocation = response.methodResponses.find(
      ([name, , id]) => id === queryCallId && name === "ContactCard/query",
    );
    const getInvocation = response.methodResponses.find(
      ([name, , id]) => id === getCallId && name === "ContactCard/get",
    );
    if (getInvocation) {
      const getResponse = getInvocation[1] as unknown as GetResponse<JmapContactCard>;
      this.client.setState(accountId, CONTACT_CARD_TYPE, getResponse.state);
      return getResponse;
    }
    const errorInvocation = response.methodResponses.find(
      ([name, , id]) => name === "error" && id === getCallId,
    );
    const queryIds = (queryInvocation?.[1] as QueryResponse | undefined)?.ids;
    if (
      errorInvocation &&
      (errorInvocation[1] as JmapMethodErrorArgs).type === "requestTooLarge" &&
      queryIds
    ) {
      return this.#getContactCardsByIds(accountId, queryIds);
    }
    const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
    throw new Error(`ContactCard query+get failed: ${detail}`);
  }

  /**
   * Initial sync: AddressBook/get plus ContactCard/query, then ContactCard/get
   * in maxObjectsInGet pages. A get-all (`ids: null`) is rejected once the
   * account has more cards than that limit.
   */
  async getAddressBooksAndCards(accountId: JmapId): Promise<{
    books: GetResponse<JmapAddressBook>;
    cards: GetResponse<JmapContactCard>;
  }> {
    const booksCallId = this.client.nextCallId();
    const queryCallId = this.client.nextCallId();
    const response = await this.client.request(
      [
        ["AddressBook/get", { accountId, ids: null }, booksCallId],
        ["ContactCard/query", { accountId }, queryCallId],
      ],
      CONTACTS_USING,
    );
    const booksInvocation = response.methodResponses.find(
      ([name, , id]) => id === booksCallId && name === "AddressBook/get",
    );
    const queryInvocation = response.methodResponses.find(
      ([name, , id]) => id === queryCallId && name === "ContactCard/query",
    );
    if (!booksInvocation || !queryInvocation) {
      const errorInvocation = response.methodResponses.find(([name]) => name === "error");
      const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
      throw new Error(`Contacts initial sync failed: ${detail}`);
    }
    const books = booksInvocation[1] as unknown as GetResponse<JmapAddressBook>;
    this.client.setState(accountId, ADDRESS_BOOK_TYPE, books.state);
    const queryIds = (queryInvocation[1] as QueryResponse).ids ?? [];
    const cards = await this.#getContactCardsByIds(accountId, queryIds);
    return { books, cards };
  }

  #coreLimit(name: "maxObjectsInGet" | "maxCallsInRequest", fallback: number): number {
    const core = this.client.session.capabilities[CORE_CAPABILITY];
    if (!core || typeof core !== "object") return fallback;
    const value = Number((core as Record<string, unknown>)[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  #maxObjectsInGet(): number {
    return this.#coreLimit("maxObjectsInGet", DEFAULT_MAX_OBJECTS_IN_GET);
  }

  #maxCallsInRequest(): number {
    return this.#coreLimit("maxCallsInRequest", DEFAULT_MAX_CALLS_IN_REQUEST);
  }

  async #getContactCardsByIds(
    accountId: JmapId,
    ids: JmapId[],
    properties?: string[] | null,
  ): Promise<GetResponse<JmapContactCard>> {
    const pageSize = this.#maxObjectsInGet();
    if (ids.length <= pageSize) {
      return this.#getContactCardsPage(accountId, ids, properties);
    }
    const list: JmapContactCard[] = [];
    const notFound: JmapId[] = [];
    let state: JmapState = "";
    let responseAccountId = accountId;
    const pages: JmapId[][] = [];
    for (let index = 0; index < ids.length; index += pageSize) {
      pages.push(ids.slice(index, index + pageSize));
    }
    const callsPerRequest = Math.max(1, this.#maxCallsInRequest());
    for (let index = 0; index < pages.length; index += callsPerRequest) {
      const batch = pages.slice(index, index + callsPerRequest);
      const methodCalls: JmapInvocation[] = batch.map((pageIds) => [
        "ContactCard/get",
        {
          accountId,
          ids: pageIds,
          ...(properties !== undefined ? { properties } : {}),
        },
        this.client.nextCallId(),
      ]);
      const response = await this.client.request(methodCalls, CONTACTS_USING);
      for (const invocation of response.methodResponses) {
        const [name, args, callId] = invocation;
        if (name === "error") {
          throw new JmapMethodError("ContactCard/get", callId, args as JmapMethodErrorArgs);
        }
        if (name !== "ContactCard/get") continue;
        const page = args as unknown as GetResponse<JmapContactCard>;
        responseAccountId = page.accountId;
        state = page.state;
        list.push(...page.list);
        notFound.push(...(page.notFound ?? []));
      }
    }
    this.client.setState(accountId, CONTACT_CARD_TYPE, state);
    return { accountId: responseAccountId, state, list, notFound };
  }

  async #getContactCardsPage(
    accountId: JmapId,
    ids: JmapId[],
    properties?: string[] | null,
  ): Promise<GetResponse<JmapContactCard>> {
    const response = await this.client.call<GetResponse<JmapContactCard>>(
      "ContactCard/get",
      {
        accountId,
        ids,
        ...(properties !== undefined ? { properties } : {}),
      },
      CONTACTS_USING,
    );
    this.client.setState(accountId, CONTACT_CARD_TYPE, response.state);
    return response;
  }
}
