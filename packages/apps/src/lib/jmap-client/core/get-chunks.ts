import { CORE_CAPABILITY, type GetResponse, type JmapId, type JmapSession } from "./types.js";

/** RFC 8620 does not set a default; 500 is what the WGW server advertises. */
export const DEFAULT_MAX_OBJECTS_IN_GET = 500;

/**
 * Page size of every get except the lean contact pass. The server may allow more (1000 since
 * #2284, for lean contact cards); notes, events, messages and file nodes can be tens of KB
 * each, and a 1000-object page of those does not fit PHP's 128 MB, so they stay at 500.
 */
export const GENERAL_GET_PAGE_CAP = 500;

/** The server's `maxObjectsInGet` from the session core capability, or the default, capped at {@link GENERAL_GET_PAGE_CAP}. */
export function maxObjectsInGet(
  session: Pick<JmapSession, "capabilities">,
  fallback = DEFAULT_MAX_OBJECTS_IN_GET,
): number {
  const core = session.capabilities[CORE_CAPABILITY];
  const advertised = (() => {
    if (!core || typeof core !== "object") return fallback;
    const value = Number((core as Record<string, unknown>).maxObjectsInGet);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  })();
  return Math.min(advertised, GENERAL_GET_PAGE_CAP);
}

/**
 * Run a JMAP `Foo/get` for `ids` in requests of at most `chunkSize` ids, so a long id
 * list does not fail with `requestTooLarge` (#1726, #1780). One page is one
 * request. Lists and `notFound` are concatenated.
 *
 * The returned `state` is the first page's. When the server changed between
 * pages, a later `/changes` from that state reports the change again, while a
 * later page's state could skip a change made to an id of an earlier page.
 */
export async function getInChunks<T>(
  ids: readonly JmapId[],
  chunkSize: number,
  getPage: (ids: JmapId[]) => Promise<GetResponse<T>>,
): Promise<GetResponse<T>> {
  const size = Math.max(1, Math.floor(chunkSize));
  if (ids.length <= size) return getPage([...ids]);
  const list: T[] = [];
  const notFound: JmapId[] = [];
  let first: GetResponse<T> | null = null;
  for (let index = 0; index < ids.length; index += size) {
    const page = await getPage(ids.slice(index, index + size));
    first ??= page;
    list.push(...page.list);
    notFound.push(...(page.notFound ?? []));
  }
  return { accountId: first!.accountId, state: first!.state, list, notFound };
}
