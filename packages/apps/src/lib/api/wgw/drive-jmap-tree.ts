import {
  DEFAULT_MAX_CALLS_IN_REQUEST,
  DEFAULT_MAX_OBJECTS_IN_GET,
  type DriveJmapSession,
} from "@/lib/api/wgw/drive-jmap";
import {
  fileNodeUsing,
  type JmapFileNode,
  type JmapInvocation,
  type JmapMethodErrorArgs,
} from "@/lib/jmap-client";

/** One keyset page of the tree: the query's ids and the nodes the get returned. */
export type FileNodeTreePage = { ids: string[]; nodes: JmapFileNode[] };

/**
 * One request of the tree walk (#2063 C1). Pages before the first failed query
 * or get only; the cursor may advance through them and no further.
 */
export type FileNodeTreeBatch = {
  /** `/state` of the leading `FileNode/get`; only when the batch started the walk. */
  state: string | null;
  /** The hole-free prefix of the request's pages, in order. */
  pages: FileNodeTreePage[];
  /** A query in that prefix succeeded with fewer than `limit` ids: the walk is complete. */
  done: boolean;
  /** A query or get failed before the walk ended; pages after it were discarded. */
  failed: boolean;
};

/**
 * One batched request of the tree walk: query+get pairs chained by a top-level
 * `#idAfter` reference to `/ids/{limit-1}` of the previous query (RFC 8620
 * §3.7). Without `asOfState` the request starts the walk: it opens with
 * `FileNode/get` on no ids and every query takes `#asOfState` from its
 * `/state`. With 32 calls per request that is the state get plus 15 pairs, and
 * 16 pairs on every later request.
 *
 * The walk ends only on a successful short page; the `invalidResultReference`
 * errors after it are ignored. A page counts only when its query and its get
 * both succeeded and every page before it in the request did too.
 */
export async function fetchFileNodeTreeBatch(
  session: DriveJmapSession,
  cursor: { asOfState: string | null; idAfter: string | null },
  signal?: AbortSignal,
): Promise<FileNodeTreeBatch> {
  const { client, accountId } = session;
  const limit = session.maxObjectsInGet ?? DEFAULT_MAX_OBJECTS_IN_GET;
  const maxCalls = session.maxCallsInRequest ?? DEFAULT_MAX_CALLS_IN_REQUEST;
  const calls: JmapInvocation[] = [];
  const stateCallId = cursor.asOfState === null ? client.nextCallId() : null;
  if (stateCallId) calls.push(["FileNode/get", { accountId, ids: [] }, stateCallId]);
  const pairs = Math.max(1, Math.floor((maxCalls - calls.length) / 2));
  const pairIds: Array<{ query: string; get: string }> = [];
  for (let index = 0; index < pairs; index += 1) {
    const query = client.nextCallId();
    const get = client.nextCallId();
    const previous = pairIds[index - 1]?.query;
    calls.push([
      "FileNode/query",
      {
        accountId,
        filter: null,
        sort: [{ property: "id", isAscending: true }],
        limit,
        ...(previous
          ? {
              "#idAfter": { resultOf: previous, name: "FileNode/query", path: `/ids/${limit - 1}` },
            }
          : cursor.idAfter !== null
            ? { idAfter: cursor.idAfter }
            : {}),
        ...(stateCallId
          ? { "#asOfState": { resultOf: stateCallId, name: "FileNode/get", path: "/state" } }
          : { asOfState: cursor.asOfState }),
      },
      query,
    ]);
    calls.push([
      "FileNode/get",
      { accountId, "#ids": { resultOf: query, name: "FileNode/query", path: "/ids" } },
      get,
    ]);
    pairIds.push({ query, get });
  }

  const response = await client.request(
    calls,
    fileNodeUsing(client),
    signal ? { signal } : undefined,
  );
  const byId = new Map<string, [string, Record<string, unknown>]>();
  for (const [name, args, id] of response.methodResponses) byId.set(id, [name, args]);
  const succeeded = (id: string, name: string): Record<string, unknown> | null => {
    const answer = byId.get(id);
    return answer && answer[0] === name ? answer[1] : null;
  };

  let state: string | null = null;
  if (stateCallId) {
    const got = succeeded(stateCallId, "FileNode/get");
    if (!got || typeof got.state !== "string") {
      return { state: null, pages: [], done: false, failed: true };
    }
    state = got.state;
  }
  const pages: FileNodeTreePage[] = [];
  for (const pair of pairIds) {
    const query = succeeded(pair.query, "FileNode/query");
    const get = succeeded(pair.get, "FileNode/get");
    if (!query || !get || !Array.isArray(query.ids)) {
      warnTreeHole(
        [byId.get(pair.query), byId.get(pair.get)].find(
          (a) => a?.[0] !== undefined && a[0] === "error",
        ),
      );
      return { state, pages, done: false, failed: true };
    }
    const ids = query.ids as string[];
    pages.push({ ids, nodes: (get.list as JmapFileNode[] | undefined) ?? [] });
    // A server that caps `limit` says so in the answer; a full capped page is not the end.
    const pageLimit = typeof query.limit === "number" ? query.limit : limit;
    if (ids.length < pageLimit) return { state, pages, done: true, failed: false };
  }
  return { state, pages, done: false, failed: false };
}

function warnTreeHole(answer: [string, Record<string, unknown>] | undefined): void {
  const detail = answer?.[0] === "error" ? (answer[1] as JmapMethodErrorArgs).type : "no answer";
  console.warn("[drive-tree] a tree page failed; the walk retries from it", { detail });
}
