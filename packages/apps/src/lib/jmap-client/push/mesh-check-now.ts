import type { PushSink, PushTransport } from "./push-transport";

/**
 * What the presence mesh offers `check-now` (#1662): a throttled, targeted
 * send and the nudges peers sent this tab. The presence store implements it;
 * `src/lib` holds only the port, so lib code never imports a `*-core` package.
 */
export type MeshCheckNowPort = {
  /** Nudge these users' browsers. Unknown or offline users just miss it. */
  sendCheckNow(usernames: readonly string[]): void;
  /** A peer sent this tab a `check-now`; returns the unsubscribe function. */
  subscribeCheckNow(listener: () => void): () => void;
};

let port: MeshCheckNowPort | null = null;
const portListeners = new Set<() => void>();

/** The presence provider registers its store here; returns the unregister function. */
export function registerMeshCheckNowPort(next: MeshCheckNowPort): () => void {
  port = next;
  for (const listener of portListeners) listener();
  return () => {
    if (port !== next) return;
    port = null;
    for (const listener of portListeners) listener();
  };
}

/**
 * After a successful write: ask these users' browsers to check the server now.
 * Send only to users known to share the written data or named by the server as
 * notified. Without a mesh this does nothing; the event source still delivers.
 */
export function sendMeshCheckNow(usernames: readonly string[]): void {
  if (usernames.length === 0) return;
  port?.sendCheckNow(usernames);
}

/** Calls `listener` for every `check-now` this tab receives, across store swaps. */
export function subscribeMeshCheckNow(listener: () => void): () => void {
  let detach: (() => void) | null = null;
  const attach = () => {
    detach?.();
    detach = port?.subscribeCheckNow(listener) ?? null;
  };
  attach();
  portListeners.add(attach);
  return () => {
    portListeners.delete(attach);
    detach?.();
    detach = null;
  };
}

/**
 * Wake-only push transport: a peer's `check-now` makes the leader's event
 * source reconnect now. Two early reconnects start at least 2 s apart
 * (`wakeGapMs`), so a storm of nudges costs at most one extra request per 2 s.
 */
export class MeshCheckNowTransport implements PushTransport {
  start(sink: PushSink): () => void {
    return subscribeMeshCheckNow(() => sink.wake("check-now"));
  }
}
