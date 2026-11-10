import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  wgwFetchPrincipal,
  wgwHasAuthenticatedSession,
  wgwIsGuestSession,
} from "@/lib/api/wgw/http";
import { registerMeshCheckNowPort } from "@/lib/jmap-client/push/mesh-check-now";
import { getPrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import type { RtcSettings } from "@/lib/rtc/types";
import {
  decidePresenceJoinMode,
  readPresenceEnvironment,
} from "@/presence-core/src/presence-join-timing";
import { createPresenceRtcSession } from "@/presence-core/src/presence-rtc-session";
import { createPresenceStore, type PresenceStore } from "@/presence-core/src/presence-store";
import {
  fetchOwnTeamRooms,
  fetchTeamRoomRtcSettings,
  TEAM_CHECK_INTERVAL_MS,
  TEAM_CHECK_MIN_GAP_MS,
} from "@/presence-core/src/presence-team-rooms";
import { PRESENCE_BOOT_RETRY_DELAYS_MS } from "@/presence-core/src/presence-types";
import { TeamPresenceSession } from "@/presence-core/src/team-presence-session";
import { TeamPrincipalLinks } from "@/presence-core/src/team-principal-links";

const PresenceStoreContext = createContext<PresenceStore | null>(null);

/**
 * Suite-level presence store, when mounted above the router (live app). Null in
 * mock/Storybook trees and while no authenticated member session exists.
 */
export function usePresenceStoreContext(): PresenceStore | null {
  return useContext(PresenceStoreContext);
}

/** Bare store injector for tests: provides an existing store without any RTC boot. */
export function PresenceStoreValueProvider({
  store,
  children,
}: {
  store: PresenceStore | null;
  children: ReactNode;
}) {
  return <PresenceStoreContext.Provider value={store}>{children}</PresenceStoreContext.Provider>;
}

/** Login happens in-tab without an observable event; recheck the stored session cheaply. */
const AUTH_RECHECK_INTERVAL_MS = 3000;

function hasMemberSession(): boolean {
  return wgwHasAuthenticatedSession() && !wgwIsGuestSession();
}

function browserReportsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Mounts principal presence for authenticated members: one mesh room per own
 * Team (#1921), merged into one roster. Waits for an authenticated (non-guest)
 * session, reads the Team list and RTC settings and the member identity, then
 * starts the store with the environment-appropriate join timing. When a request
 * fails (offline start, API unreachable) no mesh is created; the boot runs again
 * on the `online` event and on a backoff that repeats its last delay.
 *
 * The Team list is read again when the tab is shown, when the browser comes
 * back online, when a room refuses this user (removed from a Team), and every
 * five minutes; the mesh-owning tab then joins and leaves rooms to match.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<PresenceStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    let booting = false;
    let activeStore: PresenceStore | null = null;
    let unregisterCheckNow: (() => void) | null = null;
    let recheckTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const clearRetryTimer = () => {
      if (retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleRetry = () => {
      clearRetryTimer();
      // Offline: a request now fails the same way; wait for the `online` event.
      if (!browserReportsOnline()) return;
      // The last delay repeats: `online` never fires while the browser keeps reporting online.
      const delay =
        PRESENCE_BOOT_RETRY_DELAYS_MS[
          Math.min(retryAttempt, PRESENCE_BOOT_RETRY_DELAYS_MS.length - 1)
        ];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        start();
      }, delay);
    };

    let rtcSettings: RtcSettings | null = null;
    let latestRooms: string[] = [];
    let currentSession: TeamPresenceSession | null = null;
    let teamCheckInFlight = false;
    let lastTeamCheckAt = 0;
    let teamCheckTimer: ReturnType<typeof setInterval> | null = null;
    const links = new TeamPrincipalLinks(getPrincipalLinkRegistry());

    /** Reads the Team list; fetches RTC settings the first time a Team exists. */
    const loadTeamRooms = async (): Promise<string[]> => {
      const rooms = await fetchOwnTeamRooms();
      if (rooms.length > 0 && rtcSettings === null) {
        rtcSettings = await fetchTeamRoomRtcSettings(rooms[0]);
      }
      return rooms;
    };

    const checkTeams = async (fromTimer = false) => {
      if (cancelled || teamCheckInFlight || !activeStore) return;
      // Follower windows hold no rooms; the mesh-owning window checks for them.
      if (!activeStore.meshLeader) return;
      const now = Date.now();
      if (!fromTimer && now - lastTeamCheckAt < TEAM_CHECK_MIN_GAP_MS) return;
      teamCheckInFlight = true;
      lastTeamCheckAt = now;
      try {
        const rooms = await loadTeamRooms();
        if (cancelled) return;
        latestRooms = rooms;
        currentSession?.setRooms(rooms);
      } catch {
        // Keep the rooms we have; the next trigger tries again.
      } finally {
        teamCheckInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (documentVisible()) void checkTeams();
    };

    const onOnlineAfterBoot = () => {
      void checkTeams();
    };

    const createTeamSession = () => {
      const session = new TeamPresenceSession({
        createRoomSession: (room) => {
          if (rtcSettings === null) throw new Error("presence: no RTC settings yet");
          return createPresenceRtcSession({
            room,
            rtcSettings,
            linkRegistry: links.sinkFor(room),
            onRefused: () => void checkTeams(),
          });
        },
        onRoomRemoved: (room) => links.removeRoom(room),
      });
      session.setRooms(latestRooms);
      currentSession = session;
      // A window that takes over the mesh may hold an old list: read it again soon.
      setTimeout(() => void checkTeams(), 0);
      return session;
    };

    const boot = async () => {
      booting = true;
      let session: Awaited<ReturnType<typeof wgwFetchPrincipal>>;
      try {
        latestRooms = await loadTeamRooms();
        session = await wgwFetchPrincipal();
      } catch {
        // Network error or identity fetch failed: no mesh without the Team list and identity.
        booting = false;
        if (!cancelled) scheduleRetry();
        return;
      }
      booting = false;
      if (cancelled) return;
      window.removeEventListener("online", onOnline);
      const presenceStore = createPresenceStore({
        createSession: createTeamSession,
        joinMode: decidePresenceJoinMode(readPresenceEnvironment()),
        // Phase 4 (#695): one principal dial per user across windows/tabs.
        crossWindowLeader: true,
      });
      activeStore = presenceStore;
      lastTeamCheckAt = Date.now();
      unregisterCheckNow = registerMeshCheckNowPort(presenceStore);
      presenceStore.start({
        username: session.user.username ?? "",
        displayName: session.user.displayName,
      });
      setStore(presenceStore);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("online", onOnlineAfterBoot);
      teamCheckTimer = setInterval(() => {
        if (documentVisible()) void checkTeams(true);
      }, TEAM_CHECK_INTERVAL_MS);
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

    function start() {
      if (cancelled || booting || activeStore) return;
      if (!tryBoot() && recheckTimer === null) {
        recheckTimer = setInterval(tryBoot, AUTH_RECHECK_INTERVAL_MS);
      }
    }

    function onOnline() {
      clearRetryTimer();
      retryAttempt = 0;
      start();
    }

    window.addEventListener("online", onOnline);
    start();

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("online", onOnlineAfterBoot);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (teamCheckTimer !== null) clearInterval(teamCheckTimer);
      clearRetryTimer();
      if (recheckTimer !== null) clearInterval(recheckTimer);
      unregisterCheckNow?.();
      if (activeStore) void activeStore.stop();
    };
  }, []);

  return <PresenceStoreContext.Provider value={store}>{children}</PresenceStoreContext.Provider>;
}
