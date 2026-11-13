import type { ChatMessage, MeetChatOperations } from "@/lib/models/meet-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  createHybridMeetChatOperations,
  type MeetChatAuthor,
} from "@/lib/offline/meet-chat-hybrid-operations";
import {
  readMeetChatBootstrapFromCache,
  readMeetChatSyncToken,
  removeChatMessageFromCache,
  upsertChatMessageInCache,
  writeMeetChatBootstrapMetaToCache,
  writeMeetChatDirectoryToCache,
  writeMeetChatSyncToken,
  type MeetChatCachedBootstrap,
} from "@/lib/offline/meet-chat-offline-store";

/**
 * Writes the parts of a cached bootstrap that the bootstrap owns: session,
 * RTC settings, the people directory and the messages. Channel rows are the
 * server's wire rows, which only the channel sync writes, so they are left
 * as they are.
 */
async function writeMeetChatBootstrapToCache(
  username: string,
  bootstrap: MeetChatCachedBootstrap,
): Promise<void> {
  await writeMeetChatBootstrapMetaToCache(username, bootstrap.session, bootstrap.rtc);
  if (bootstrap.directory !== undefined) {
    await writeMeetChatDirectoryToCache(username, bootstrap.directory, bootstrap.groups);
  }
  for (const message of bootstrap.messages) {
    await upsertChatMessageInCache(username, message);
  }
}

/**
 * Meet chat persistence wired to {@link OfflineDomainStore}. The entity is a
 * message; a token scope is one channel (each channel pulls its own messages).
 * Channel rows, DM ids and outbox payloads stay on `meet-chat-offline-store.ts`.
 */
export const meetChatOfflineDomainStore = {
  readBootstrap: readMeetChatBootstrapFromCache,
  writeBootstrap: writeMeetChatBootstrapToCache,
  upsertEntity: upsertChatMessageInCache,
  removeEntity: removeChatMessageFromCache,
  readSyncToken: readMeetChatSyncToken,
  writeSyncToken: writeMeetChatSyncToken,
} satisfies OfflineDomainStore<MeetChatCachedBootstrap, ChatMessage>;

/** Hybrid chat operations for one account; the author signs optimistic messages. */
export type MeetChatOperationsForAuthor = (author: MeetChatAuthor) => MeetChatOperations;

/** Meet chat hybrid API factory wired to {@link OfflineDomainOperations}. */
export const meetChatHybridDomainOperations: OfflineDomainOperations<MeetChatOperationsForAuthor> =
  (username) => (author) =>
    createHybridMeetChatOperations(username, author);
