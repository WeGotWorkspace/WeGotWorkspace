import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { CHAT_CAPABILITY, type ChangesResponse, type JmapId } from "../core/types.js";
import { JmapChatClient } from "../chat/JmapChatClient.js";
import type { JmapChatChannel, JmapChatMessage } from "../chat/types.js";

const CHANNEL_TYPE = "ChatChannel";
const MESSAGE_TYPE = "ChatMessage";

/** Safety cap on `hasMoreChanges` follow-ups inside one sync tick. */
const MAX_CHANGES_PAGES = 20;

export type JmapChatAdapterOptions = {
  client: JmapClient;
  accountId?: JmapId;
  onSyncError?: (error: unknown) => void;
  onRemoteMessage?: (message: JmapChatMessage) => void;
  onRemoteMessageDestroyed?: (messageId: JmapId) => void;
  onRemoteChannel?: (channel: JmapChatChannel) => void;
  onRemoteChannelDestroyed?: (channelId: JmapId) => void;
  onRefetchAll?: (snapshot: { channels: JmapChatChannel[]; messages: JmapChatMessage[] }) => void;
};

type AccumulatedChanges = {
  created: Set<JmapId>;
  updated: Set<JmapId>;
  destroyed: Set<JmapId>;
};

/**
 * Inbound-only JMAP adapter: ChatChannel/ChatMessage `/changes` polling →
 * `/get` changed ids. Mutations stay on REST `/chat/*`. Mirrors
 * `JmapNotesAdapter`, with one deliberate difference: chat volume makes
 * `hasMoreChanges` real, so `/changes` is followed up until it clears.
 */
export class JmapChatAdapter {
  #chat: JmapChatClient;
  #options: JmapChatAdapterOptions;
  #accountId: JmapId | null = null;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #pollInFlight = false;

  constructor(options: JmapChatAdapterOptions) {
    this.#options = options;
    this.#chat = new JmapChatClient(options.client);
  }

  get accountId(): JmapId {
    if (this.#accountId) return this.#accountId;
    this.#accountId =
      this.#options.accountId ?? this.#options.client.primaryAccountId(CHAT_CAPABILITY);
    return this.#accountId;
  }

  async initialize(): Promise<void> {
    if (!this.#options.client.isConnected) await this.#options.client.connect();
    // Empty ids: record envelope state without re-listing every object.
    await this.#chat.getChannels(this.accountId, []);
    await this.#chat.getMessages(this.accountId, []);
  }

  async #drainChanges(
    fetchChanges: (sinceState: string) => Promise<ChangesResponse>,
    type: string,
  ): Promise<AccumulatedChanges | null> {
    const client = this.#options.client;
    let sinceState = client.getState(this.accountId, type);
    if (!sinceState) return null;
    const accumulated: AccumulatedChanges = {
      created: new Set(),
      updated: new Set(),
      destroyed: new Set(),
    };
    for (let page = 0; page < MAX_CHANGES_PAGES; page++) {
      const changes = await fetchChanges(sinceState);
      for (const id of changes.created) accumulated.created.add(id);
      for (const id of changes.updated) accumulated.updated.add(id);
      for (const id of changes.destroyed) accumulated.destroyed.add(id);
      sinceState = changes.newState;
      if (!changes.hasMoreChanges) break;
    }
    return accumulated;
  }

  async sync(): Promise<void> {
    try {
      const channelChanges = await this.#drainChanges(
        (sinceState) => this.#chat.channelChanges(this.accountId, sinceState),
        CHANNEL_TYPE,
      );
      if (channelChanges) {
        const changedIds = [...channelChanges.created, ...channelChanges.updated].filter(
          (id) => !channelChanges.destroyed.has(id),
        );
        if (changedIds.length) {
          const fetched = await this.#chat.getChannels(this.accountId, changedIds);
          for (const channel of fetched.list) {
            this.#options.onRemoteChannel?.(channel);
          }
        }
        for (const id of channelChanges.destroyed) {
          this.#options.onRemoteChannelDestroyed?.(id);
        }
      }

      const messageChanges = await this.#drainChanges(
        (sinceState) => this.#chat.messageChanges(this.accountId, sinceState),
        MESSAGE_TYPE,
      );
      if (messageChanges) {
        const changedIds = [...messageChanges.created, ...messageChanges.updated].filter(
          (id) => !messageChanges.destroyed.has(id),
        );
        const dedupedIds = [...new Set(changedIds)];
        if (dedupedIds.length) {
          const fetched = await this.#chat.getMessages(this.accountId, dedupedIds);
          for (const message of fetched.list) {
            this.#options.onRemoteMessage?.(message);
          }
        }
        for (const id of messageChanges.destroyed) {
          this.#options.onRemoteMessageDestroyed?.(id);
        }
      }
    } catch (error) {
      if (error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges") {
        await this.#refetchAll();
        return;
      }
      this.#options.onSyncError?.(error);
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.#pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (this.#pollInFlight) return;
      this.#pollInFlight = true;
      void this.sync().finally(() => {
        this.#pollInFlight = false;
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  /** Full resync after `cannotCalculateChanges` (server pruned the change log). */
  async #refetchAll(): Promise<void> {
    const channels = await this.#chat.getChannels(this.accountId);
    const messages = await this.#chat.getMessages(this.accountId);
    if (this.#options.onRefetchAll) {
      this.#options.onRefetchAll({ channels: channels.list, messages: messages.list });
      return;
    }
    for (const channel of channels.list) {
      this.#options.onRemoteChannel?.(channel);
    }
    for (const message of messages.list) {
      this.#options.onRemoteMessage?.(message);
    }
  }
}
