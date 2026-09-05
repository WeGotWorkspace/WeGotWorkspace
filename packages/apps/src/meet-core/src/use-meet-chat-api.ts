import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  chatMessageFromWire,
  type WgwChatChannel,
  type WgwChatMessage,
} from "@/lib/api/wgw/meet-chat";
import { createMeetChatJmapClient } from "@/lib/api/wgw/meet-chat-jmap";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapChatAdapter, type JmapChatChannel, type JmapChatMessage } from "@/lib/jmap-client";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  getMeetChatSyncRunner,
  meetChatBootstrapFromCached,
} from "@/lib/offline/meet-chat-hybrid-operations";
import {
  backfillChatChannelHistory,
  syncMeetChatInboundFromRest,
} from "@/lib/offline/meet-chat-inbound-sync";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatChannelDestroyed,
  ingestRemoteChatMessage,
  ingestRemoteChatMessageDestroyed,
  reconcileMeetChatSnapshot,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  isChatChannelBackfilled,
  readMeetChatBootstrapFromCache,
} from "@/lib/offline/meet-chat-offline-store";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import {
  readOfflineMeetChatUsername,
  resolveMeetChatOfflineUsername,
} from "@/lib/offline/offline-session";
import type { MeetAppBootstrap, MeetUIData } from "@/meet-core/src/meet-types";
import {
  createDefaultMeetChatApiSource,
  type MeetChatApiSource,
} from "@/meet-core/src/meet-chat-api-source";

/** Live JMAP inbound poll — chat cadence (spec: ~3–5s, vs Notes 10s). */
const CHAT_CHANGES_POLL_MS = 4_000;

/** JMAP wire chat objects mirror the REST schemas — see docs/meet-chat-client.md. */
function jmapChatMessageToApp(message: JmapChatMessage) {
  return chatMessageFromWire(message as WgwChatMessage);
}

function jmapChatChannelToWire(channel: JmapChatChannel): WgwChatChannel {
  return channel as unknown as WgwChatChannel;
}

export function useMeetChatAPI(source?: MeetChatApiSource) {
  const { online } = useConnectivity();
  const resolvedSource = useMemo(() => source ?? createDefaultMeetChatApiSource(), [source]);
  const placeholderData = useMemo<MeetUIData>(
    () => ({
      defaultDisplayName: "Guest",
      rtc: {
        stunUrls: "",
        turnUrls: "",
        turnUsername: "",
        turnPassword: "",
        forceRelay: false,
      },
      channels: [],
      messages: [],
    }),
    [],
  );

  const runBootstrap = useCallback(() => resolvedSource.loadBootstrap(), [resolvedSource]);
  const readCache = useCallback(async () => {
    if (!wgwLiveApiEnabled()) return null;
    const username = readOfflineMeetChatUsername();
    if (!username) return null;
    const cached = await readMeetChatBootstrapFromCache(username);
    return cached ? meetChatBootstrapFromCached(cached) : null;
  }, []);

  const { phase, error, data, load, successVersion, patchBootstrap } =
    useHybridBootstrap<MeetAppBootstrap>({
      load: runBootstrap,
      readCache,
    });

  const offlineUsername = useMemo(
    () =>
      wgwLiveApiEnabled() ? resolveMeetChatOfflineUsername(data?.session.user.username) : null,
    [data?.session.user.username],
  );

  const [listRefreshing, setListRefreshing] = useState(false);

  const patchFromCache = useCallback(async () => {
    if (!offlineUsername) return;
    const cached = await readMeetChatBootstrapFromCache(offlineUsername);
    if (!cached) return;
    // Patch channels/messages/dmUnread only — session/rtc stay from the live
    // bootstrap and successVersion is untouched, so the workspace never remounts.
    patchBootstrap((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          channels: cached.channels,
          messages: cached.messages,
          dmUnread: cached.dmUnread,
        },
      };
    });
  }, [offlineUsername, patchBootstrap]);

  const bootstrapRef = useRef(data);
  bootstrapRef.current = data;
  const rawOperations = useMemo(
    () => resolvedSource.createOperations(bootstrapRef.current ?? undefined),
    // Hybrid ops close over username/displayName only. Recreating on every inbound
    // patch would drop in-memory read-marker dedupe.
    [resolvedSource, data?.session.user.displayName, data?.session.user.username],
  );

  const operations = useMemo(() => {
    if (!rawOperations?.markChannelRead) return rawOperations;
    const markChannelRead = rawOperations.markChannelRead;
    return {
      ...rawOperations,
      markChannelRead: async (channelId: string) => {
        await markChannelRead(channelId);
        await patchFromCache();
      },
    };
  }, [patchFromCache, rawOperations]);

  const applyInboundRefresh = useCallback(async () => {
    if (!offlineUsername) return;
    await syncMeetChatInboundFromRest(offlineUsername);
    await patchFromCache();
  }, [offlineUsername, patchFromCache]);

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void applyInboundRefresh().finally(() => {
      setListRefreshing(false);
    });
  }, [applyInboundRefresh, listRefreshing]);

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getMeetChatSyncRunner(offlineUsername).flush();
      await applyInboundRefresh();
    },
  });

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;
    if (!wgwLiveApiEnabled()) return;

    const username = offlineUsername;
    const adapter = new JmapChatAdapter({
      client: createMeetChatJmapClient(),
      onRemoteMessage: (message) => {
        void ingestRemoteChatMessage(username, jmapChatMessageToApp(message)).then(() => {
          void patchFromCache();
        });
      },
      onRemoteMessageDestroyed: (messageId) => {
        void ingestRemoteChatMessageDestroyed(username, messageId).then(() => {
          void patchFromCache();
        });
      },
      onRemoteChannel: (channel) => {
        void (async () => {
          await ingestRemoteChatChannel(username, jmapChatChannelToWire(channel));
          // A channel newly shared/created remotely needs its history pulled once.
          if (!(await isChatChannelBackfilled(username, channel.id))) {
            await backfillChatChannelHistory(username, channel.id).catch(() => undefined);
          }
          await patchFromCache();
        })();
      },
      onRemoteChannelDestroyed: (channelId) => {
        void ingestRemoteChatChannelDestroyed(username, channelId).then(() => {
          void patchFromCache();
        });
      },
      onRefetchAll: ({ channels, messages }) => {
        void reconcileMeetChatSnapshot(
          username,
          channels.map(jmapChatChannelToWire),
          messages.map(jmapChatMessageToApp),
        ).then(() => {
          void patchFromCache();
        });
      },
    });

    let cancelled = false;
    void adapter
      .initialize()
      .then(() => {
        if (cancelled) return;
        adapter.startPolling(CHAT_CHANGES_POLL_MS);
      })
      .catch(() => {
        // Session missing the chat capability (chunk D not deployed) — the REST
        // reconnect/refresh path still converges state.
      });

    return () => {
      cancelled = true;
      adapter.stopPolling();
    };
  }, [offlineUsername, online, patchFromCache, phase]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    syncing: reconnectSyncing,
    listLoading: phase === "loading" || reconnectSyncing,
    listRefreshing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
  };
}
