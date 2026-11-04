import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  getMeetChatSyncRunner,
  meetChatBootstrapFromCached,
} from "@/lib/offline/meet-chat-hybrid-operations";
import { syncMeetChatInboundFromRest } from "@/lib/offline/meet-chat-inbound-sync";
import { readMeetChatBootstrapFromCache } from "@/lib/offline/meet-chat-offline-store";
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
import { useMeetChatLiveInbound } from "@/meet-core/src/use-meet-chat-live-inbound";

export function useMeetChatAPI(source?: MeetChatApiSource) {
  const { online } = useConnectivity();
  const resolvedSource = useMemo(() => source ?? createDefaultMeetChatApiSource(), [source]);
  const placeholderData = useMemo<MeetUIData>(
    () => ({
      defaultDisplayName: "Guest",
      rtc: {
        stunUrls: "",
        turnAvailable: false,
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
    // Patch list state only — session/rtc stay from the live bootstrap and
    // successVersion is untouched, so the workspace never remounts.
    patchBootstrap((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          channels: cached.channels,
          messages: cached.messages,
          dmUnread: cached.dmUnread,
          ...(cached.directory !== undefined ? { directory: cached.directory } : {}),
          ...(cached.groups !== undefined ? { groups: cached.groups } : {}),
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

  const applyInboundRefreshRef = useRef(applyInboundRefresh);
  applyInboundRefreshRef.current = applyInboundRefresh;
  const didInitialInboundRef = useRef(false);
  useEffect(() => {
    didInitialInboundRef.current = false;
  }, [offlineUsername]);

  // Inbound catch-up after first paint: cache (channels + directory) already
  // mounted the workspace. Flush + REST history must not block the DM rail.
  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;
    if (!wgwLiveApiEnabled()) return;
    if (didInitialInboundRef.current) return;
    didInitialInboundRef.current = true;
    let cancelled = false;
    const username = offlineUsername;
    void getMeetChatSyncRunner(username)
      .flush()
      .then(() => {
        if (cancelled) return;
        return applyInboundRefreshRef.current();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [offlineUsername, online, phase]);

  useMeetChatLiveInbound({
    username: offlineUsername,
    enabled: online && phase === "ready",
    patchFromCache,
  });

  return {
    phase,
    error,
    retry: load,
    successVersion,
    syncing: reconnectSyncing,
    listLoading: phase === "loading",
    listRefreshing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
    patchFromCache,
  };
}
