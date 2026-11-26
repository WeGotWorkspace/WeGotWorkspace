import { useCallback, useEffect, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useOnReconnect } from "@/hooks/use-connectivity";
import type { CalendarAvailabilityPublicLinkOperations } from "@/lib/api/wgw/calendar-availability-public-link";
import { getConnectivitySnapshot, isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { copyShareText } from "@/share-ui/share-path-utils";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { defaultCalendarAvailabilityPublicLinkOperations } from "@/settings-core/src/settings-calendar-public-link-source";
import {
  loadServerSettings,
  type ServerSettingsPhase,
} from "@/settings-core/src/settings-server-load";
import type { CalendarAvailabilityPublicLink } from "@wgw/openapi-types/calendars-types";

export type SettingsCalendarPublicLinkController = {
  phase: ServerSettingsPhase;
  /** The link as the server last returned it; null until the first read. */
  link: CalendarAvailabilityPublicLink | null;
  /** A turn on, new link or turn off is in flight. */
  busy: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  regenerate: () => Promise<void>;
  copy: () => Promise<void>;
  retry: () => void;
};

class PublicLinkOfflineError extends Error {}

function isOffline(error: unknown): boolean {
  return error instanceof PublicLinkOfflineError || isFetchNetworkError(error);
}

/**
 * The public availability link (#2406): read fresh when the pane opens, changed by explicit
 * actions (turn on, new link, turn off), never cached locally. A clean pane re-reads when the
 * window returns to front or the connection comes back, so a second tab shows the current link.
 */
export function useSettingsCalendarPublicLink(
  operations: CalendarAvailabilityPublicLinkOperations = defaultCalendarAvailabilityPublicLinkOperations(),
): SettingsCalendarPublicLinkController {
  const { showError, showSuccess } = useAppToast();
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const [phase, setPhase] = useState<ServerSettingsPhase>("loading");
  const [link, setLink] = useState<CalendarAvailabilityPublicLink | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const linkRef = useRef(link);
  linkRef.current = link;

  const apply = useCallback((next: CalendarAvailabilityPublicLink) => {
    linkRef.current = next;
    setLink(next);
    setPhase("ready");
  }, []);

  const load = useCallback(
    (quiet: boolean) =>
      loadServerSettings({
        quiet,
        requestRef,
        read: () => operationsRef.current.load(),
        isDirty: () => busyRef.current,
        isOffline,
        setPhase,
        apply,
      }),
    [apply],
  );

  useEffect(() => {
    void load(false);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const refresh = useCallback(() => {
    if (phaseRef.current === "ready") void load(true);
    else if (phaseRef.current !== "loading") void load(false);
  }, [load]);
  useOnReconnect(refresh);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<CalendarAvailabilityPublicLink | void>, success?: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        if (!getConnectivitySnapshot()) throw new PublicLinkOfflineError();
        requestRef.current += 1;
        const next = await action();
        apply(next ?? { enabled: false });
        if (success) showSuccess(success);
      } catch (error) {
        showError(isOffline(error) ? labels.publicLinkSaveOffline : labels.publicLinkSaveError);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [apply, showError, showSuccess],
  );

  const setEnabled = useCallback(
    (enabled: boolean) =>
      run(
        async () => {
          if (enabled) return operationsRef.current.turnOn();
          await operationsRef.current.turnOff();
          return { enabled: false };
        },
        enabled ? labels.publicLinkOn : labels.publicLinkOff,
      ),
    [run],
  );

  const regenerate = useCallback(
    () => run(() => operationsRef.current.regenerate(), labels.publicLinkRegenerated),
    [run],
  );

  const copy = useCallback(async () => {
    const url = linkRef.current?.httpsUrl;
    if (url && (await copyShareText(url))) showSuccess(labels.publicLinkCopied);
  }, [showSuccess]);

  return { phase, link, busy, setEnabled, regenerate, copy, retry: () => void load(false) };
}
