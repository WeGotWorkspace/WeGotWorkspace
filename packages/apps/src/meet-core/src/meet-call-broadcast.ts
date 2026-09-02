export const MEET_CALL_BROADCAST_CHANNEL = "wgw.meet.call";

/** Remote entries expire when a tab crashes without posting `inactive`. */
const REMOTE_ACTIVE_TTL_MS = 45_000;
/** Active tabs re-announce so TTL-pruned entries recover and stale ones expire. */
const SWEEP_INTERVAL_MS = 15_000;

export type MeetCallBroadcastMessage =
  | { kind: "active"; tabId: string; roomCode: string | null }
  | { kind: "inactive"; tabId: string }
  | { kind: "query"; tabId: string };

export type MeetCallBroadcast = {
  /** Announce or clear this tab's active call. No-op when the state did not change. */
  setLocalActive: (active: boolean, roomCode: string | null) => void;
  close: () => void;
};

type BroadcastChannelLike = {
  postMessage: (message: unknown) => void;
  close: () => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

export type CreateMeetCallBroadcastOptions = {
  onRemoteActiveChange: (active: boolean) => void;
  /** Test ports. */
  channelFactory?: (name: string) => BroadcastChannelLike;
  now?: () => number;
  tabId?: string;
};

function defaultChannelFactory(name: string): BroadcastChannelLike | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(name);
}

/**
 * Lightweight cross-tab "call active in another tab" signal. Media stays strictly
 * per-tab (no leader election); this only informs other tabs so the UI can
 * discourage double-joining.
 */
export function createMeetCallBroadcast(
  options: CreateMeetCallBroadcastOptions,
): MeetCallBroadcast | null {
  const channel = options.channelFactory
    ? options.channelFactory(MEET_CALL_BROADCAST_CHANNEL)
    : defaultChannelFactory(MEET_CALL_BROADCAST_CHANNEL);
  if (!channel) return null;

  const now = options.now ?? (() => Date.now());
  const tabId = options.tabId ?? Math.random().toString(36).slice(2, 12);

  const remoteActiveTabs = new Map<string, number>();
  let localActive = false;
  let localRoomCode: string | null = null;
  let lastReportedRemoteActive = false;

  const post = (message: MeetCallBroadcastMessage) => {
    try {
      channel.postMessage(message);
    } catch {
      // Best-effort signal; ignore serialization/closed-channel failures.
    }
  };

  const reportRemoteActive = () => {
    const cutoff = now() - REMOTE_ACTIVE_TTL_MS;
    for (const [id, seenAt] of remoteActiveTabs) {
      if (seenAt < cutoff) remoteActiveTabs.delete(id);
    }
    const active = remoteActiveTabs.size > 0;
    if (active === lastReportedRemoteActive) return;
    lastReportedRemoteActive = active;
    options.onRemoteActiveChange(active);
  };

  channel.onmessage = (event: MessageEvent) => {
    const message = event.data as MeetCallBroadcastMessage | null;
    if (!message || typeof message !== "object" || message.tabId === tabId) return;
    if (message.kind === "active") {
      remoteActiveTabs.set(message.tabId, now());
    } else if (message.kind === "inactive") {
      remoteActiveTabs.delete(message.tabId);
    } else if (message.kind === "query" && localActive) {
      post({ kind: "active", tabId, roomCode: localRoomCode });
    }
    reportRemoteActive();
  };

  const sweepTimer = setInterval(() => {
    if (localActive) post({ kind: "active", tabId, roomCode: localRoomCode });
    reportRemoteActive();
  }, SWEEP_INTERVAL_MS);

  post({ kind: "query", tabId });

  return {
    setLocalActive: (active: boolean, roomCode: string | null) => {
      if (active === localActive && roomCode === localRoomCode) return;
      localActive = active;
      localRoomCode = roomCode;
      post(active ? { kind: "active", tabId, roomCode } : { kind: "inactive", tabId });
    },
    close: () => {
      clearInterval(sweepTimer);
      if (localActive) post({ kind: "inactive", tabId });
      channel.onmessage = null;
      channel.close();
    },
  };
}
