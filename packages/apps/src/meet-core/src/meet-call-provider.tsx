import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { createMeetCallBroadcast } from "@/meet-core/src/meet-call-broadcast";
import { createMeetCallStore, type MeetCallStore } from "@/meet-core/src/meet-call-store";
import { sendMeetLeaveBeacon } from "@/meet-core/src/meet-leave-beacon";

const MeetCallStoreContext = createContext<MeetCallStore | null>(null);

/**
 * Suite-level call store, when mounted above the router (live app). Null in
 * mock/Storybook trees, where meet state stays per-mount.
 */
export function useMeetCallStoreContext(): MeetCallStore | null {
  return useContext(MeetCallStoreContext);
}

function isCallEngaged(store: MeetCallStore): boolean {
  const status = store.statusRef.current;
  return status === "in-call" || status === "preparing" || status === "waiting";
}

/**
 * Page-level leave behavior: the call survives route changes, but closing or
 * navigating away from the page still warns and drops the peer from the roster.
 */
function useMeetCallPageLifecycle(store: MeetCallStore): void {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isCallEngaged(store)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onPageHide = () => {
      const status = store.statusRef.current;
      if (status !== "in-call" && status !== "waiting") return;
      const roomCode = store.roomCodeRef.current;
      const peerId = store.selfIdRef.current;
      if (!roomCode || !peerId) return;
      sendMeetLeaveBeacon({
        roomCode,
        peerId,
        sessionKey: store.rtcSessionRef.current?.getSessionKey() ?? undefined,
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [store]);
}

/** Cross-tab "call active in another tab" signal (no leader election, media stays per-tab). */
function useMeetCallTabSignal(store: MeetCallStore): void {
  useEffect(() => {
    const broadcast = createMeetCallBroadcast({
      onRemoteActiveChange: (active) => store.setRemoteCallActive(active),
    });
    if (!broadcast) return;

    const syncLocal = () => {
      const snapshot = store.getSnapshot();
      broadcast.setLocalActive(isCallEngaged(store), snapshot.roomCode);
    };
    syncLocal();
    const unsubscribe = store.subscribe(syncLocal);
    return () => {
      unsubscribe();
      broadcast.close();
    };
  }, [store]);
}

export function MeetCallProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<MeetCallStore | null>(null);
  storeRef.current ??= createMeetCallStore();
  const store = storeRef.current;

  useMeetCallPageLifecycle(store);
  useMeetCallTabSignal(store);

  return <MeetCallStoreContext.Provider value={store}>{children}</MeetCallStoreContext.Provider>;
}
