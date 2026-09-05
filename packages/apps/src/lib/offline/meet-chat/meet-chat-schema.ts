import type { EntityTable } from "dexie";
import {
  registerOfflineDomainTables,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import { MEET_CHAT_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";

export type OfflineChatChannelRow = {
  id: string;
  data: string;
};

export type OfflineChatMessageRow = {
  id: string;
  channelId: string;
  data: string;
  pendingSync: boolean;
  /** Message `createdAt` (epoch ms). Indexed for per-channel timeline reads. */
  createdAt: number;
};

export const MEET_CHAT_DOMAIN = "meet-chat";

/**
 * Meet chat Dexie tables, registered as additive versions on top of the core
 * `{ meta, outbox }` baseline (v1):
 *
 * - **v60** introduces `meet_chat_channels` and `meet_chat_messages`.
 *
 * Message ids are client-generated ULIDs (lexicographically time-sortable), so the
 * primary key alone orders a channel timeline; `createdAt` is indexed for range reads.
 */
registerOfflineDomainTables({
  domain: MEET_CHAT_DOMAIN,
  versions: [
    {
      version: MEET_CHAT_OFFLINE_VERSION.tables,
      stores: {
        meet_chat_channels: "id",
        meet_chat_messages: "id, channelId, pendingSync, createdAt",
      },
    },
  ],
});

export function meetChatChannelsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineChatChannelRow, "id"> {
  return db.table<OfflineChatChannelRow, string>("meet_chat_channels") as EntityTable<
    OfflineChatChannelRow,
    "id"
  >;
}

export function meetChatMessagesTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineChatMessageRow, "id"> {
  return db.table<OfflineChatMessageRow, string>("meet_chat_messages") as EntityTable<
    OfflineChatMessageRow,
    "id"
  >;
}
