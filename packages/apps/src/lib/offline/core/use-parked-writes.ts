import { useCallback, useEffect, useRef, useState } from "react";
import { holdCrossTabLockIfFree } from "@/lib/offline/core/cross-tab-lock";
import {
  listParkedWrites,
  subscribeParkedWrites,
  takeParkedWrites,
  type ParkedWrite,
} from "@/lib/offline/core/parked-writes";

export type ParkedWritesDialog<T> = {
  writes: ParkedWrite<T>[];
  /** This tab shows the dialog. Only one tab does at a time. */
  open: boolean;
  /** Open it from the entry point. False when another tab shows it. */
  openDialog: () => Promise<boolean>;
  /** Close without choosing: the writes stay parked and the entry point stays. */
  closeDialog: () => void;
  /** Take writes out to rescue or discard them (see `takeParkedWrites`). */
  take: (ids: string[]) => Promise<ParkedWrite<T>[]>;
};

/**
 * The parked writes of one domain and the one dialog that asks where they go
 * (#1825). The dialog opens by itself on load and when a write is parked that
 * this tab has not offered yet, but only in the tab that gets the lock; closed,
 * it stays closed until a new write is parked or the page loads again.
 */
export function useParkedWrites<T>(username: string | null, domain: string): ParkedWritesDialog<T> {
  const [writes, setWrites] = useState<ParkedWrite<T>[]>([]);
  const [open, setOpen] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const offered = useRef(new Set<string>());
  const lockName = `wgw-parked-writes-dialog:${domain}:${username ?? ""}`;

  const letGo = useCallback(() => {
    release.current?.();
    release.current = null;
    setOpen(false);
  }, []);

  const openDialog = useCallback(async () => {
    if (release.current) return true;
    const got = await holdCrossTabLockIfFree(lockName);
    if (!got) return false;
    release.current = got;
    setOpen(true);
    return true;
  }, [lockName]);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    const load = async () => {
      const next = await listParkedWrites<T>(username, domain).catch(() => []);
      if (cancelled) return;
      setWrites(next);
      if (next.length === 0) return letGo();
      const fresh = next.some((write) => !offered.current.has(write.id));
      for (const write of next) offered.current.add(write.id);
      if (fresh) await openDialog();
    };
    void load();
    const stop = subscribeParkedWrites(username, domain, () => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [domain, letGo, openDialog, username]);

  useEffect(() => letGo, [letGo]);

  const take = useCallback(
    (ids: string[]) =>
      username ? takeParkedWrites<T>(username, domain, ids) : Promise.resolve([]),
    [domain, username],
  );

  return { writes, open, openDialog, closeDialog: letGo, take };
}
