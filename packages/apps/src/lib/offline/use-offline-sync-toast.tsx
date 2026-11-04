import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";

/**
 * Toast when a reconnect/outbox flush cycle completes (syncing → done). Never
 * while the tab is offline again. `landed`, when given, says whether the
 * cycle's changes reached the server; without it every completed cycle counts.
 */
export function useOfflineSyncToast(
  syncing: boolean,
  clearedLabel: string,
  landed?: () => boolean,
): void {
  const wasSyncingRef = useRef(false);
  const landedRef = useRef(landed);
  landedRef.current = landed;
  const { show } = useAppToast();

  useEffect(() => {
    const finished = wasSyncingRef.current && !syncing;
    wasSyncingRef.current = syncing;
    if (!finished || !getConnectivitySnapshot()) return;
    if (landedRef.current && !landedRef.current()) return;
    show(clearedLabel, { icon: <Check className="size-4" /> });
  }, [clearedLabel, show, syncing]);
}

/**
 * Toast when the open document's unsaved changes reached the server (pending
 * → cleared). Not while offline: a pending flag cleared then (a room that
 * rejoined, a document that moved) saved nothing. `key` names the document:
 * when it changes, the flag of the new document starts over without a toast.
 */
export function useOfflinePendingToast(
  pending: boolean,
  clearedLabel: string,
  enabled = true,
  key?: string,
): void {
  const wasPendingRef = useRef(false);
  const keyRef = useRef(key);
  const { show } = useAppToast();

  useEffect(() => {
    if (!enabled) {
      wasPendingRef.current = false;
      return;
    }
    const sameDocument = keyRef.current === key;
    keyRef.current = key;
    const cleared = sameDocument && wasPendingRef.current && !pending;
    wasPendingRef.current = pending;
    if (cleared && getConnectivitySnapshot()) {
      show(clearedLabel, { icon: <Check className="size-4" /> });
    }
  }, [clearedLabel, enabled, key, pending, show]);
}
