export type CrossTabTopic<T> = {
  /** This tab's listeners hear it at once; other tabs through a BroadcastChannel. */
  publish: (message: T, options?: { otherTabsOnly?: boolean }) => void;
  subscribe: (listener: (message: T) => void) => () => void;
};

/**
 * One kind of message shared by every open tab of this browser, for events
 * the shared offline cache cannot signal by itself (a create landed, another
 * tab archived something).
 */
export function crossTabTopic<T>(
  channelName: string,
  isMessage: (value: unknown) => value is T,
): CrossTabTopic<T> {
  const listeners = new Set<(message: T) => void>();
  let channel: BroadcastChannel | null | undefined;

  const emit = (message: T) => {
    for (const listener of listeners) listener(message);
  };
  const open = (): BroadcastChannel | null => {
    if (channel !== undefined) return channel;
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(channelName) : null;
    channel?.addEventListener("message", (event: MessageEvent) => {
      if (isMessage(event.data)) emit(event.data);
    });
    return channel;
  };

  return {
    publish(message, options) {
      if (!options?.otherTabsOnly) emit(message);
      open()?.postMessage(message);
    },
    subscribe(listener) {
      open();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
