import { JmapSetItemError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import {
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  type ChangesResponse,
  type GetResponse,
  type JmapId,
  type JmapState,
  type QueryResponse,
  type SetArgs,
  type SetResponse,
} from "../core/types.js";
import type { JmapFileNode, JmapFileNodeCreate, JmapFileNodeFilter } from "./types.js";

const FILE_NODE_TYPE = "FileNode";

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

function firstGetResponse<T>(
  methodResponses: Array<[string, Record<string, unknown>, string]>,
  getCallId: string,
): GetResponse<T> {
  const getInvocation = methodResponses.find(
    ([name, , id]) => id === getCallId && name === "FileNode/get",
  );
  if (!getInvocation) {
    const errorInvocation = methodResponses.find(([name]) => name === "error");
    const detail = errorInvocation ? JSON.stringify(errorInvocation[1]) : "no response";
    throw new Error(`FileNode query+get failed: ${detail}`);
  }
  return getInvocation[1] as unknown as GetResponse<T>;
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
   * (contract test batch).
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
    const getResponse = firstGetResponse<JmapFileNode>(response.methodResponses, getCallId);
    this.client.setState(accountId, FILE_NODE_TYPE, getResponse.state);
    return getResponse;
  }
}
