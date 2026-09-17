import { JmapMethodError, JmapSetItemError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import {
  CORE_CAPABILITY,
  MAIL_CAPABILITY,
  SUBMISSION_CAPABILITY,
  type ChangesResponse,
  type GetResponse,
  type JmapId,
  type JmapState,
  type QueryResponse,
  type SetArgs,
  type SetResponse,
} from "../core/types.js";
import type {
  JmapEmail,
  JmapEmailFilterCondition,
  JmapEmailSubmission,
  JmapIdentity,
  JmapMailbox,
  JmapThread,
} from "./types.js";

const MAILBOX_TYPE = "Mailbox";
const EMAIL_TYPE = "Email";
const THREAD_TYPE = "Thread";
const IDENTITY_TYPE = "Identity";
const SUBMISSION_TYPE = "EmailSubmission";

export const MAIL_USING = [CORE_CAPABILITY, MAIL_CAPABILITY];
export const SUBMISSION_USING = [CORE_CAPABILITY, MAIL_CAPABILITY, SUBMISSION_CAPABILITY];

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
 * Typed RFC 8621 Mail / Submission methods. Batches match
 * `JmapMailClientContractTest` (`using` + `#ids` ResultReference).
 */
export class JmapMailClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  async getMailboxes(accountId: JmapId, ids?: JmapId[] | null): Promise<GetResponse<JmapMailbox>> {
    const response = await this.client.call<GetResponse<JmapMailbox>>(
      "Mailbox/get",
      { accountId, ids: ids ?? null },
      MAIL_USING,
    );
    this.client.setState(accountId, MAILBOX_TYPE, response.state);
    return response;
  }

  async mailboxChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>(
      "Mailbox/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      MAIL_USING,
    );
    this.client.setState(accountId, MAILBOX_TYPE, response.newState);
    return response;
  }

  async setMailboxes(
    args: Omit<SetArgs<Partial<JmapMailbox>>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapMailbox>> {
    const response = await this.client.call<SetResponse<JmapMailbox>>(
      "Mailbox/set",
      args,
      MAIL_USING,
    );
    this.client.setState(args.accountId, MAILBOX_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }

  async queryEmails(
    accountId: JmapId,
    filter?: JmapEmailFilterCondition | null,
    options: { position?: number; limit?: number; calculateTotal?: boolean } = {},
  ): Promise<QueryResponse> {
    return this.client.call<QueryResponse>(
      "Email/query",
      {
        accountId,
        ...(filter ? { filter } : {}),
        ...options,
      },
      MAIL_USING,
    );
  }

  async getEmails(
    accountId: JmapId,
    ids?: JmapId[] | null,
    properties?: string[] | null,
  ): Promise<GetResponse<JmapEmail>> {
    const response = await this.client.call<GetResponse<JmapEmail>>(
      "Email/get",
      {
        accountId,
        ids: ids ?? null,
        ...(properties ? { properties } : {}),
      },
      MAIL_USING,
    );
    this.client.setState(accountId, EMAIL_TYPE, response.state);
    return response;
  }

  /**
   * One-round-trip `Email/query` + `Email/get` wired with `#ids`
   * ResultReference — the sequence pinned in JmapMailClientContractTest.
   */
  async getEmailsByQuery(
    accountId: JmapId,
    filter?: JmapEmailFilterCondition | null,
    options: { position?: number; limit?: number; properties?: string[] | null } = {},
  ): Promise<GetResponse<JmapEmail>> {
    const queryCallId = this.client.nextCallId();
    const getCallId = this.client.nextCallId();
    const queryArgs: Record<string, unknown> = {
      accountId,
      ...(filter ? { filter } : {}),
      ...(options.position !== undefined ? { position: options.position } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    };
    const getArgs: Record<string, unknown> = {
      accountId,
      "#ids": {
        resultOf: queryCallId,
        name: "Email/query",
        path: "/ids",
      },
    };
    if (options.properties) getArgs.properties = options.properties;
    const response = await this.client.request(
      [
        ["Email/query", queryArgs, queryCallId],
        ["Email/get", getArgs, getCallId],
      ],
      MAIL_USING,
    );
    const getInvocation = response.methodResponses.find(
      ([name, , id]) => id === getCallId && name === "Email/get",
    );
    if (getInvocation) {
      const getResponse = getInvocation[1] as unknown as GetResponse<JmapEmail>;
      this.client.setState(accountId, EMAIL_TYPE, getResponse.state);
      return getResponse;
    }
    const errorInvocation = response.methodResponses.find(
      ([name, , id]) => name === "error" && id === getCallId,
    );
    throw new JmapMethodError(
      "Email/get",
      getCallId,
      (errorInvocation?.[1] as { type?: string; description?: string }) ?? {
        type: "serverFail",
        description: "Email query+get failed",
      },
    );
  }

  async emailChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>(
      "Email/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      MAIL_USING,
    );
    this.client.setState(accountId, EMAIL_TYPE, response.newState);
    return response;
  }

  async setEmails(
    args: Omit<SetArgs<Partial<JmapEmail>>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapEmail>> {
    const response = await this.client.call<SetResponse<JmapEmail>>("Email/set", args, MAIL_USING);
    this.client.setState(args.accountId, EMAIL_TYPE, response.newState);
    return response;
  }

  async getThreads(accountId: JmapId, ids: JmapId[]): Promise<GetResponse<JmapThread>> {
    const response = await this.client.call<GetResponse<JmapThread>>(
      "Thread/get",
      { accountId, ids },
      MAIL_USING,
    );
    this.client.setState(accountId, THREAD_TYPE, response.state);
    return response;
  }

  async getIdentities(accountId: JmapId): Promise<GetResponse<JmapIdentity>> {
    const response = await this.client.call<GetResponse<JmapIdentity>>(
      "Identity/get",
      { accountId, ids: null },
      SUBMISSION_USING,
    );
    this.client.setState(accountId, IDENTITY_TYPE, response.state);
    return response;
  }

  async setEmailSubmissions(
    args: Omit<SetArgs<Partial<JmapEmailSubmission>>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapEmailSubmission>> {
    const response = await this.client.call<SetResponse<JmapEmailSubmission>>(
      "EmailSubmission/set",
      args,
      SUBMISSION_USING,
    );
    this.client.setState(args.accountId, SUBMISSION_TYPE, response.newState);
    return response;
  }
}
