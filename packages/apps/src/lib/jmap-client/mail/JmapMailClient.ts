import type { JmapClient } from "../core/JmapClient.js";
import { CORE_CAPABILITY, MAIL_CAPABILITY, type JmapId, type JmapState } from "../core/types.js";
import type { components } from "@wgw/openapi-types/openapi-types";

/** RFC 8621 Mailbox, as far as `urn:wgw:jmap:mail` carries it (read-only IMAP folders). */
export type JmapMailbox = components["schemas"]["MailMailbox"];

export type JmapMailboxGetResponse = {
  accountId: JmapId;
  state: JmapState;
  list: JmapMailbox[];
  notFound: JmapId[];
};

export const MAIL_USING = [CORE_CAPABILITY, MAIL_CAPABILITY];

/**
 * `Mailbox/get` over {@link JmapClient}. Each call logs in to the user's mail server, so the
 * server counts it with saving and testing the mailbox: ask only when a list is needed.
 */
export class JmapMailClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  accountId(): JmapId {
    return this.client.primaryAccountId(MAIL_CAPABILITY);
  }

  isSupported(): boolean {
    return this.client.isConnected && MAIL_CAPABILITY in this.client.session.capabilities;
  }

  getMailboxes(
    properties: (keyof JmapMailbox)[] | null = null,
    accountId: JmapId = this.accountId(),
  ): Promise<JmapMailboxGetResponse> {
    return this.client.call<JmapMailboxGetResponse>(
      "Mailbox/get",
      { accountId, ids: null, properties },
      MAIL_USING,
    );
  }
}
