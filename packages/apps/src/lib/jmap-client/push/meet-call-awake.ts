import type { AwakeSource } from "./jmap-push-hub";

/**
 * Whether this tab is in a live Meet call (`in-call`, not the lobby). Such a
 * tab local-acks while hidden, so its push stream keeps the visible pace and
 * it sees a new inbox row within the local-ack grace (#2129). The app sets
 * it; the push hub reads it.
 */
let inCall = false;
const listeners = new Set<() => void>();

export const meetCallAwake: AwakeSource = {
  awake: () => inCall,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function setPushInMeetCall(next: boolean): void {
  if (next === inCall) return;
  inCall = next;
  for (const listener of listeners) listener();
}
