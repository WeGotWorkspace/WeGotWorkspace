import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  wgwApiBaseUrl,
  wgwFetchPrincipal,
  wgwHasAuthenticatedSession,
  wgwIsGuestSession,
} from "@/lib/api/wgw/http";
import { fetchRtcSettings } from "@/lib/api/wgw/rtc";
import { resolveRoomId } from "@/lib/rtc/room-id";
import {
  decidePresenceJoinMode,
  readPresenceEnvironment,
} from "@/presence-core/src/presence-join-timing";
import { createPresenceRtcSession } from "@/presence-core/src/presence-rtc-session";
import { createPresenceStore, type PresenceStore } from "@/presence-core/src/presence-store";
import { PRESENCE_WORKSPACE_ROOM } from "@/presence-core/src/presence-types";

const PresenceStoreContext = createContext<PresenceStore | null>(null);

/**
 * Suite-level presence store, when mounted above the router (live app). Null in
 * mock/Storybook trees and while no authenticated member session exists.
 */
export function usePresenceStoreContext(): PresenceStore | null {
  return useContext(PresenceStoreContext);
}

/** Login happens in-tab without an observable event; recheck the stored session cheaply. */
const AUTH_RECHECK_INTERVAL_MS = 3000;

function hasMemberSession(): boolean {
  return wgwHasAuthenticatedSession() && !wgwIsGuestSession();
}

async function startPresence(store: PresenceStore): Promise<void> {
  const session = await wgwFetchPrincipal();
  store.start({
    username: session.user.username ?? "",
    displayName: session.user.displayName,
  });
}

/**
 * Mounts the workspace-wide principal presence mesh for authenticated members.
 * Waits for an authenticated (non-guest) session, resolves RTC settings once, then
 * starts the store with the environment-appropriate join timing.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<PresenceStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeStore: PresenceStore | null = null;
    let recheckTimer: ReturnType<typeof setInterval> | null = null;

    const boot = async () => {
      const roomId = resolveRoomId("principal", PRESENCE_WORKSPACE_ROOM);
      const rtcSettings = await fetchRtcSettings({
        url: `${wgwApiBaseUrl()}/rooms/${encodeURIComponent(roomId)}/configuration`,
      });
      if (cancelled) return;
      const presenceStore = createPresenceStore({
        createSession: () =>
          createPresenceRtcSession({ room: PRESENCE_WORKSPACE_ROOM, rtcSettings }),
        joinMode: decidePresenceJoinMode(readPresenceEnvironment()),
        // Phase 4 (#695): one principal dial per user across windows/tabs.
        crossWindowLeader: true,
      });
      activeStore = presenceStore;
      try {
        await startPresence(presenceStore);
      } catch {
        // Identity fetch failed (e.g. session dropped between checks); stay unmounted.
        return;
      }
      if (cancelled) {
        void presenceStore.stop();
        return;
      }
      setStore(presenceStore);
    };

    const tryBoot = () => {
      if (!hasMemberSession()) return false;
      if (recheckTimer !== null) {
        clearInterval(recheckTimer);
        recheckTimer = null;
      }
      void boot();
      return true;
    };

    if (!tryBoot()) {
      recheckTimer = setInterval(tryBoot, AUTH_RECHECK_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (recheckTimer !== null) clearInterval(recheckTimer);
      if (activeStore) void activeStore.stop();
    };
  }, []);

  return <PresenceStoreContext.Provider value={store}>{children}</PresenceStoreContext.Provider>;
}
