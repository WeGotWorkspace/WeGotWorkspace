import { JmapSetItemError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import {
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  type ChangesResponse,
  type GetResponse,
  type JmapId,
  type JmapMethodErrorArgs,
  type JmapState,
  type QueryResponse,
  type SetArgs,
  type SetResponse,
} from "../core/types.js";
import type { JmapFileNode, JmapFileNodeCreate, JmapFileNodeFilter } from "./types.js";

const FILE_NODE_TYPE = "FileNode";
/** RFC 8620 floor when the session omits `maxObjectsInGet`; the WGW server also uses 500. */
const DEFAULT_MAX_OBJECTS_IN_GET = 500;

export const FILENODE_USING = [CORE_CAPABILITY, FILENODE_CAPABILITY];

function assertSetSucceeded<T>(response: SetResponse<T>): void {
  const notCreated = Object.entries(response.notCreated ?? {});
  if (notCreated.length) throw new JmapSetItemError("create", notCreated[0][0], notCreated[0][1]);
  const notUpdated = Object.entries(response.notUpdated ?? {});
  if (notUpdated.length) throw new JmapSetItemError("update", notUpdated[0][0], notUpdated[0][1]);
  const notDestroyed = Object.entries(response.notDestroyed ?? {});
  if (notDestroyed.length)
    throw new JmapSetItemError("destroy", notDestroyed[0][0], notDestroyed[0][1]);
}

type QueryAndGetOutcome<T> =
  { kind: "got"; response: GetResponse<T> } | { kind: "tooLarge"; ids: JmapId[] };

/**
 * Reads the `FileNode/get` answer of a query+get batch. A get rejected with
 * `requestTooLarge` hands back the query ids so the caller can fetch them in
 * chunks; any other failure throws.
 */
function readQueryAndGet<T>(
  methodResponses: Array<[string, Record<string, unknown>, string]>,
  queryCallId: string,
  getCallId: string,
): QueryAndGetOutcome<T> {
  const getInvocation = methodResponses.find(
    ([name, , id]) => id === getCallId && name === "FileNode/get",
  );
  if (getInvocation) {
    return { kind: "got", response: getInvocation[1] as unknown as GetResponse<T> };
  }
  const getError = methodResponses.find(([name, , id]) => name === "error" && id === getCallId);
  const queryInvocation = methodResponses.find(
    ([name, , id]) => id === queryCallId && name === "FileNode/query",
  );
  const queryIds = (queryInvocation?.[1] as QueryResponse | undefined)?.ids;
  if (getError && (getError[1] as JmapMethodErrorArgs).type === "requestTooLarge" && queryIds) {
    return { kind: "tooLarge", ids: queryIds };
  }
  const errorInvocation = getError ?? methodResponses.find(([name]) => name === "error");
  const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
  throw new Error(`FileNode query+get failed: ${detail}`);
}

/**
 * Typed FileNode methods (draft-ietf-jmap-filenode-14) over {@link JmapClient}.
 * Batches match `JmapFileNodesClientContractTest` (`using` + `#ids` ResultReference).
 */
export class JmapFileNodesClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  async getFileNodes(
    accountId: JmapId,
    ids?: JmapId[] | null,
    options: { signal?: AbortSignal } = {},
  ): Promise<GetResponse<JmapFileNode>> {
    const response = await this.client.call<GetResponse<JmapFileNode>>(
      "FileNode/get",
      { accountId, ids: ids ?? null },
      { using: FILENODE_USING, signal: options.signal },
    );
    this.client.setState(accountId, FILE_NODE_TYPE, response.state);
    return response;
  }

  async fileNodeChanges(
    accountId: JmapId,
    sinceState: JmapState,
    options: { maxChanges?: number; signal?: AbortSignal } = {},
  ): Promise<ChangesResponse> {
    const response = await this.client.call<ChangesResponse>(
      "FileNode/changes",
      {
        accountId,
        sinceState,
        ...(options.maxChanges !== undefined ? { maxChanges: options.maxChanges } : {}),
      },
      { using: FILENODE_USING, signal: options.signal },
    );
    this.client.setState(accountId, FILE_NODE_TYPE, response.newState);
    return response;
  }

  async setFileNodes(
    args: Omit<SetArgs<JmapFileNodeCreate>, "accountId"> & {
      accountId: JmapId;
      onDestroyRemoveChildren?: boolean;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<SetResponse<JmapFileNode>> {
    const response = await this.client.call<SetResponse<JmapFileNode>>("FileNode/set", args, {
      using: FILENODE_USING,
      signal: options.signal,
    });
    this.client.setState(args.accountId, FILE_NODE_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }

  async queryFileNodes(
    accountId: JmapId,
    filter?: JmapFileNodeFilter | null,
    options: { signal?: AbortSignal } = {},
  ): Promise<QueryResponse> {
    return this.client.call<QueryResponse>(
      "FileNode/query",
      { accountId, filter: filter ?? null },
      { using: FILENODE_USING, signal: options.signal },
    );
  }

  /**
   * One-round-trip `FileNode/query` + `FileNode/get` wired with `#ids`
   * (contract test batch). When the query matches more nodes than the
   * server's `maxObjectsInGet`, the get is rejected with `requestTooLarge`;
   * the query ids are then fetched in chunks of at most that limit.
   */
  async queryAndGetFileNodes(
    accountId: JmapId,
    filter: JmapFileNodeFilter,
    options: { signal?: AbortSignal } = {},
  ): Promise<GetResponse<JmapFileNode>> {
    const queryCallId = this.client.nextCallId();
    const getCallId = this.client.nextCallId();
    const response = await this.client.request(
      [
        ["FileNode/query", { accountId, filter }, queryCallId],
        [
          "FileNode/get",
          {
            accountId,
            "#ids": {
              resultOf: queryCallId,
              name: "FileNode/query",
              path: "/ids",
            },
          },
          getCallId,
        ],
      ],
      FILENODE_USING,
      options.signal ? { signal: options.signal } : undefined,
    );
    const outcome = readQueryAndGet<JmapFileNode>(response.methodResponses, queryCallId, getCallId);
    if (outcome.kind === "tooLarge") {
      return this.#getFileNodesInChunks(accountId, outcome.ids, options.signal);
    }
    this.client.setState(accountId, FILE_NODE_TYPE, outcome.response.state);
    return outcome.response;
  }

  #maxObjectsInGet(): number {
    const core = this.client.session.capabilities[CORE_CAPABILITY];
    if (!core || typeof core !== "object") return DEFAULT_MAX_OBJECTS_IN_GET;
    const value = Number((core as Record<string, unknown>).maxObjectsInGet);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_OBJECTS_IN_GET;
  }

  /** `FileNode/get` per chunk of at most `maxObjectsInGet` ids, one HTTP request each. */
  async #getFileNodesInChunks(
    accountId: JmapId,
    ids: JmapId[],
    signal?: AbortSignal,
  ): Promise<GetResponse<JmapFileNode>> {
    const chunkSize = this.#maxObjectsInGet();
    const list: JmapFileNode[] = [];
    const notFound: JmapId[] = [];
    let last: GetResponse<JmapFileNode> | null = null;
    for (let index = 0; index < ids.length; index += chunkSize) {
      last = await this.getFileNodes(accountId, ids.slice(index, index + chunkSize), { signal });
      list.push(...last.list);
      notFound.push(...(last.notFound ?? []));
    }
    return {
      accountId: last?.accountId ?? accountId,
      state: last?.state ?? "",
      list,
      notFound,
    };
  }
}
