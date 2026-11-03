import { JmapMethodError, JmapRequestError } from "./errors.js";
import { getInChunks, maxObjectsInGet } from "./get-chunks.js";
import type { JmapClient } from "./JmapClient.js";
import type {
  GetResponse,
  JmapId,
  JmapMethodErrorArgs,
  JmapResponse,
  JmapState,
  QueryResponse,
} from "./types.js";

/** Ids per `/query` page. Ids are short, so one page covers most accounts. */
export const QUERY_PAGE_SIZE = 5000;

/** A listing whose `queryState` moved between pages is started again this often. */
const MAX_LISTING_ATTEMPTS = 3;

export type FetchAllOptions = {
  accountId: JmapId;
  /** The JMAP type, e.g. `Note`: calls `Note/query` and `Note/get`. */
  type: string;
  using: string[];
  filter?: Record<string, unknown>;
  properties?: string[] | null;
  /** A lower per-request cap than `maxObjectsInGet` (e.g. heavy ContactCard bodies). */
  maxIdsPerGet?: number;
  queryPageSize?: number;
};

/**
 * Every record of a type without a get-all (#1792): the server refuses
 * `ids: null` above `maxObjectsInGet`. Lists ids with `/query` in pages,
 * then fetches them with explicit-id `/get` requests of at most
 * `maxObjectsInGet` ids each.
 *
 * The returned and recorded state is the `/get` state taken before the
 * listing, so a change made while the re-list runs is reported again by the
 * next `/changes` instead of being skipped.
 */
export async function fetchAllByQuery<T>(
  client: JmapClient,
  options: FetchAllOptions,
): Promise<GetResponse<T>> {
  const { accountId, type, using } = options;
  const listing = await listAllIds(client, options);
  const chunkSize = Math.min(
    maxObjectsInGet(client.session),
    options.maxIdsPerGet ?? Number.POSITIVE_INFINITY,
  );
  const extra = options.properties !== undefined ? { properties: options.properties } : {};
  const fetched = listing.ids.length
    ? await getInChunks(listing.ids, chunkSize, (ids) =>
        client.call<GetResponse<T>>(`${type}/get`, { accountId, ids, ...extra }, using),
      )
    : { accountId, list: [], notFound: [] };
  client.setState(accountId, type, listing.state);
  return { ...fetched, state: listing.state };
}

type IdListing = { state: JmapState; ids: JmapId[] };

async function listAllIds(client: JmapClient, options: FetchAllOptions): Promise<IdListing> {
  for (let attempt = 1; attempt <= MAX_LISTING_ATTEMPTS; attempt++) {
    const listing = await listIdsOnce(client, options);
    if (listing) return listing;
  }
  throw new JmapRequestError(`${options.type}/query kept changing while it was paged`);
}

/** One paged listing; null when the result set changed between pages. */
async function listIdsOnce(
  client: JmapClient,
  options: FetchAllOptions,
): Promise<IdListing | null> {
  const { accountId, type, using } = options;
  const pageSize = options.queryPageSize ?? QUERY_PAGE_SIZE;
  const queryArgs = (position: number) => ({
    accountId,
    ...(options.filter ? { filter: options.filter } : {}),
    position,
    limit: pageSize,
  });
  // The empty get records the state before any id is listed.
  const stateCallId = client.nextCallId();
  const queryCallId = client.nextCallId();
  const response = await client.request(
    [
      [`${type}/get`, { accountId, ids: [] }, stateCallId],
      [`${type}/query`, queryArgs(0), queryCallId],
    ],
    using,
  );
  const { state } = invocationArgs<GetResponse<unknown>>(response, `${type}/get`, stateCallId);
  let page = invocationArgs<QueryResponse>(response, `${type}/query`, queryCallId);
  const firstQueryState = page.queryState;
  const ids = [...page.ids];
  while (hasMorePages(page, ids.length, pageSize)) {
    page = await client.call<QueryResponse>(`${type}/query`, queryArgs(ids.length), using);
    if (page.queryState !== firstQueryState) return null;
    ids.push(...page.ids);
  }
  return { state, ids };
}

function hasMorePages(page: QueryResponse, listed: number, pageSize: number): boolean {
  if (page.ids.length === 0) return false;
  if (page.total !== undefined) return listed < page.total;
  return page.ids.length >= (page.limit ?? pageSize);
}

function invocationArgs<T>(response: JmapResponse, name: string, callId: string): T {
  const invocation = response.methodResponses.find(([, , id]) => id === callId);
  if (!invocation) throw new JmapRequestError(`No response for method call ${name} (${callId})`);
  if (invocation[0] === "error") {
    throw new JmapMethodError(name, callId, invocation[1] as JmapMethodErrorArgs);
  }
  return invocation[1] as T;
}
