import { useEffect, useRef, useState } from "react";
import {
  chatMessageFromWire,
  type WgwChatChannel,
  type WgwChatMessage,
} from "@/lib/api/wgw/meet-chat";
import { createMeetChatJmapClient } from "@/lib/api/wgw/meet-chat-jmap";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useJmapPushConnected, useJmapStateChange } from "@/lib/api/wgw/use-jmap-state-change";
import { JmapChatAdapter, type JmapChatChannel, type JmapChatMessage } from "@/lib/jmap-client";
import { backfillChatChannelHistory } from "@/lib/offline/meet-chat-inbound-sync";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatChannelDestroyed,
  ingestRemoteChatMessage,
  ingestRemoteChatMessageDestroyed,
  reconcileMeetChatSnapshot,
} from "@/lib/offline/meet-chat-jmap-inbound";
import { isChatChannelBackfilled } from "@/lib/offline/meet-chat-offline-store";

/** Inbound `/changes` poll while push is down: chat cadence (Notes polls every 10 s). */
export const CHAT_CHANGES_POLL_MS = 4_000;
/**
 * While push is connected the poll only backs it up. 30 s, not the 60 s of
 * Notes and Contacts: past 30 s the saving is 2 requests a minute per tab,
 * while a missed chat message is noticed sooner than a missed note (#1667).
 */
export const CHAT_CHANGES_PUSH_POLL_MS = 30_000;

const PUSH_TYPES = ["ChatChannel", "ChatMessage"] as const;
const NO_TYPES: readonly string[] = [];

/** JMAP wire chat objects mirror the REST schemas: see docs/meet-chat-client.md. */
function jmapChatMessageToApp(message: JmapChatMessage) {
  return chatMessageFromWire(message as WgwChatMessage);
}

function jmapChatChannelToWire(channel: JmapChatChannel): WgwChatChannel {
  return channel as unknown as WgwChatChannel;
}

type UseMeetChatLiveInboundArgs = {
  /** Account of the offline cache; null until the bootstrap knows it. */
  username: string | null;
  /** Online and bootstrapped: the inbound sync may run. */
  enabled: boolean;
  /** Re-read the cache into the list after an ingest. */
  patchFromCache: () => Promise<void>;
};

/**
 * Live inbound Meet chat sync over JMAP (#1667): a push for `ChatMessage` or
 * `ChatChannel` runs one `/changes` round when the pushed state differs from
 * the adapter's own. The poll backs it up every 4 s, or every 30 s while push
 * is connected. Peers on the mesh still see a message first through the mesh
 * preview (`meet-mesh-sot.ts`); this is the server-authoritative path, and the
 * only one for peers without a mesh. Without the chat capability the REST
 * reconnect and refresh paths still converge.
 */
export function useMeetChatLiveInbound({
  username,
  enabled,
  patchFromCache,
}: UseMeetChatLiveInboundArgs): void {
  const [adapter, setAdapter] = useState<JmapChatAdapter | null>(null);
  const latestPatch = useRef(patchFromCache);
  useEffect(() => {
    latestPatch.current = patchFromCache;
  }, [patchFromCache]);

  useEffect(() => {
    if (!username || !enabled) return;
    if (typeof window === "undefined" || !wgwLiveApiEnabled()) return;

    const ingested = (work: Promise<unknown>) => void work.then(() => latestPatch.current());
    const next = new JmapChatAdapter({
      client: createMeetChatJmapClient(),
      onRemoteMessage: (message) =>
        ingested(ingestRemoteChatMessage(username, jmapChatMessageToApp(message))),
      onRemoteMessageDestroyed: (messageId) =>
        ingested(ingestRemoteChatMessageDestroyed(username, messageId)),
      onRemoteChannel: (channel) =>
        ingested(
          (async () => {
            await ingestRemoteChatChannel(username, jmapChatChannelToWire(channel));
            // A channel newly shared or created remotely needs its history pulled once.
            if (!(await isChatChannelBackfilled(username, channel.id))) {
              await backfillChatChannelHistory(username, channel.id).catch(() => undefined);
            }
          })(),
        ),
      onRemoteChannelDestroyed: (channelId) =>
        ingested(ingestRemoteChatChannelDestroyed(username, channelId)),
      onRefetchAll: ({ channels, messages }) =>
        ingested(
          reconcileMeetChatSnapshot(
            username,
            channels.map(jmapChatChannelToWire),
            messages.map(jmapChatMessageToApp),
          ),
        ),
      onSyncError: (error: unknown) => console.warn("[meet-chat] live inbound sync failed", error),
    });

    let cancelled = false;
    void next
      .initialize()
      .then(() => {
        if (!cancelled) setAdapter(next);
      })
      .catch(() => {
        // Session without the chat capability: the REST reconnect and refresh
        // paths still converge state.
      });

    return () => {
      cancelled = true;
      next.stopPolling();
      setAdapter(null);
    };
  }, [enabled, username]);

  const pushConnected = useJmapPushConnected();
  useEffect(() => {
    if (!adapter) return;
    adapter.startPolling(pushConnected ? CHAT_CHANGES_PUSH_POLL_MS : CHAT_CHANGES_POLL_MS);
    return () => adapter.stopPolling();
  }, [adapter, pushConnected]);

  useJmapStateChange(adapter ? PUSH_TYPES : NO_TYPES, (states, accountId) =>
    adapter ? adapter.syncIfStale(states, accountId) : false,
  );
}
