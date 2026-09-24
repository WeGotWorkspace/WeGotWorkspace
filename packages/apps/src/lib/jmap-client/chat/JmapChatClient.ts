import type { JmapClient } from "../core/JmapClient.js";
import { CHAT_CAPABILITY, CORE_CAPABILITY } from "../core/types.js";
import type { ChangesResponse, GetResponse, JmapId, JmapState } from "../core/types.js";
import type { JmapChatChannel, JmapChatMessage } from "./types.js";

const CHANNEL_TYPE = "ChatChannel";
const MESSAGE_TYPE = "ChatMessage";

export const CHAT_USING = [CORE_CAPABILITY, CHAT_CAPABILITY];

/**
 * Typed ChatChannel / ChatMessage methods over {@link JmapClient}. Inbound-only:
 * mutations stay on REST `/chat/*` (mirrors `JmapNotesClient` for the Notes flow).
 *
 * Contract assumptions against the not-yet-built chunk D methods are documented
 * in `packages/apps/docs/meet-chat-client.md`.
 */
export class JmapChatClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  async getChannels(
    accountId: JmapId,
    ids?: JmapId[] | null,
  ): Promise<GetResponse<JmapChatChannel>> {
    const response = await this.client.call<GetResponse<JmapChatChannel>>(
      "ChatChannel/get",
      { accountId, ids: ids ?? null },
      CHAT_USING,
    );
    this.client.setState(accountId, CHANNEL_TYPE, response.state);
    return response;
  }

  async channelChanges(
    accountId: JmapId,
    sinceState: JmapState,
    maxChanges?: number,
  ): Promise<ChangesResponse> {
    const response = await this.client.call<ChangesResponse>(
      "ChatChannel/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      CHAT_USING,
    );
    this.client.setState(accountId, CHANNEL_TYPE, response.newState);
    return response;
  }

  async getMessages(
    accountId: JmapId,
    ids?: JmapId[] | null,
  ): Promise<GetResponse<JmapChatMessage>> {
    const response = await this.client.call<GetResponse<JmapChatMessage>>(
      "ChatMessage/get",
      { accountId, ids: ids ?? null },
      CHAT_USING,
    );
    this.client.setState(accountId, MESSAGE_TYPE, response.state);
    return response;
  }

  async messageChanges(
    accountId: JmapId,
    sinceState: JmapState,
    maxChanges?: number,
  ): Promise<ChangesResponse> {
    const response = await this.client.call<ChangesResponse>(
      "ChatMessage/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      CHAT_USING,
    );
    this.client.setState(accountId, MESSAGE_TYPE, response.newState);
    return response;
  }
}
