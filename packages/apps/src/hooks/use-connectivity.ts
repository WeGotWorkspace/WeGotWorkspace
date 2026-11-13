import { useEffect, useRef, useSyncExternalStore } from "react";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";

export type ConnectivityState = {
  online: boolean;
};

export function useConnectivity(): ConnectivityState {
  const online = useSyncExternalStore(subscribeBrowserOnline, getConnectivitySnapshot, () => true);

  return { online };
}

/** Runs `callback` after connectivity returns from offline (including stale `navigator.onLine`). */
export function useOnReconnect(callback: () => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let wasOffline = !getConnectivitySnapshot();

    const onConnectivityChange = () => {
      const online = getConnectivitySnapshot();
      if (!online) {
        wasOffline = true;
        return;
      }
      if (!wasOffline) return;
      wasOffline = false;
      callbackRef.current();
    };

    return subscribeBrowserOnline(onConnectivityChange);
  }, []);
}
