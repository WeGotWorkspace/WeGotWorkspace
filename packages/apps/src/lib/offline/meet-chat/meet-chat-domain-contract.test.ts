import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { MEET_CHAT_MESSAGES } from "@/lib/api/mock/meet-chat-fixtures";
import type { ChatMessage } from "@/lib/models/meet-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  meetChatHybridDomainOperations,
  meetChatOfflineDomainStore,
  type MeetChatOperationsForAuthor,
} from "@/lib/offline/meet-chat/meet-chat-domain-contract";
import {
  listPendingChatMessageIds,
  type MeetChatCachedBootstrap,
} from "@/lib/offline/meet-chat/meet-chat-offline-store";

const username = "grace";
const live = createMeetAppBootstrap();
const [first, second] = MEET_CHAT_MESSAGES as [ChatMessage, ChatMessage];
const bootstrap: MeetChatCachedBootstrap = {
  session: live.session,
  rtc: live.data.rtc,
  channels: [],
  messages: [first, second],
  dmUnread: {},
  directory: [],
};

const store: OfflineDomainStore<MeetChatCachedBootstrap, ChatMessage> = meetChatOfflineDomainStore;
const operations: OfflineDomainOperations<MeetChatOperationsForAuthor> =
  meetChatHybridDomainOperations;

describe("meet chat domain contract", () => {
  it("round-trips the session, RTC settings and messages of a bootstrap", async () => {
    await store.writeBootstrap(username, bootstrap);
    const cached = await store.readBootstrap(username);
    expect(cached?.session).toEqual(bootstrap.session);
    expect(cached?.rtc).toEqual(bootstrap.rtc);
    expect(cached?.messages.map((message) => message.id)).toEqual([first.id, second.id]);
  });

  it("upserts and removes one message", async () => {
    await store.writeBootstrap(username, bootstrap);
    await store.upsertEntity(username, { ...first, body: "Edited offline" }, true);
    await store.removeEntity(username, second.id);
    const cached = await store.readBootstrap(username);
    expect(cached?.messages.map((message) => [message.id, message.body])).toEqual([
      [first.id, "Edited offline"],
    ]);
  });

  it("replaces the message set and keeps a message with an unsynced local write", async () => {
    await store.writeBootstrap(username, bootstrap);
    await store.upsertEntity(username, { ...first, body: "Edited offline" }, true);
    // A snapshot from before the edit, which also no longer has `second`.
    await store.writeBootstrap(username, { ...bootstrap, messages: [first] });

    const cached = await store.readBootstrap(username);
    expect(cached?.messages.map((message) => [message.id, message.body])).toEqual([
      [first.id, "Edited offline"],
    ]);
    await expect(listPendingChatMessageIds(username)).resolves.toEqual([first.id]);
  });

  it("keeps one token per channel", async () => {
    await store.writeSyncToken(username, "general", "token-a");
    await store.writeSyncToken(username, "random", "token-b");
    await expect(store.readSyncToken(username, "general")).resolves.toBe("token-a");
    await expect(store.readSyncToken(username, "random")).resolves.toBe("token-b");
  });

  it("builds the hybrid chat operations for an author", () => {
    const chat = operations(username)({ id: username, displayName: "Grace" });
    expect(chat.sendMessage).toBeTypeOf("function");
  });
});
