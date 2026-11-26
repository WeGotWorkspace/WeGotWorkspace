import { useEffect, useRef, useState } from "react";
import { wgwLiveApiEnabled, wgwSettingsStateRead } from "@/lib/api/wgw/http";
import {
  readCachedTeamDisplayNames,
  sanitizeTeamDisplayNames,
  writeCachedTeamDisplayNames,
  type TeamDisplayName,
} from "@/lib/files/team-labels/team-label-store";

const NO_NAMES: readonly TeamDisplayName[] = [];

/**
 * Team display names for Drive and Docs (sidebar, breadcrumbs, pickers).
 * The cached names paint first; a successful `/settings/state` read replaces
 * them and is cached again, so a team drive keeps its name offline (#2063).
 * Without a username (guests, mocks) only the live read runs, and nothing is cached.
 */
export function useTeamDisplayNames(
  username: string | null | undefined,
  online: boolean,
): readonly TeamDisplayName[] {
  const [names, setNames] = useState<readonly TeamDisplayName[]>(NO_NAMES);
  const account = username?.trim() || null;
  /** Set once a live read answered; the cache never overwrites it. */
  const liveLoadedRef = useRef(false);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void readCachedTeamDisplayNames(account).then((cached) => {
      if (cancelled || cached.length === 0 || liveLoadedRef.current) return;
      setNames(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    if (!online || !wgwLiveApiEnabled()) return;
    const controller = new AbortController();
    void wgwSettingsStateRead
      .read()
      .then((read) => {
        if (!read.ok || controller.signal.aborted) return;
        const json = read.json as { groups?: unknown };
        if (!Array.isArray(json.groups)) return;
        const live = sanitizeTeamDisplayNames(json.groups);
        liveLoadedRef.current = true;
        setNames(live);
        if (account) void writeCachedTeamDisplayNames(account, live);
      })
      .catch(() => {
        /* best-effort labels only */
      });
    return () => controller.abort();
  }, [account, online]);

  return names;
}
