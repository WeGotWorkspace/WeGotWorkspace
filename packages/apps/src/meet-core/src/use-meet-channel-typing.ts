import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  createMeetTypingHeartbeat,
  type MeetTypingHeartbeat,
} from "@/meet-core/src/meet-typing-heartbeat";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";
import type { PresenceStore } from "@/presence-core/src/presence-store";

export type MeetChannelTyping = {
  /** Channel id -> usernames currently typing there (self excluded by the store). */
  typingByChannel: Record<string, string[]>;
  /**
   * Composer activity feed: `typing = true` on every edit with content
   * (heartbeat-throttled to one broadcast per ~4s), `false` on send / blur /
   * cleared composer (eager retraction).
   */
  onComposerTyping: (channelId: string, typing: boolean) => void;
};

const EMPTY_TYPING: Record<string, string[]> = {};

const noopSubscribe = () => () => {};

const emptySnapshot = () => EMPTY_TYPING;

/**
 * Channel typing indicators over the workspace presence mesh (chunk K).
 *
 * Transport reality: the presence mesh is the suite-level principal room
 * (`PresenceProvider` above the router) — available to authenticated members
 * whether or not an RTC call is up. When there is no transport (Storybook/mock
 * trees, guest sessions, mesh not joined yet) this degrades silently:
 * `typingByChannel` stays empty and outbound signals are dropped.
 */
export function useMeetChannelTyping(): MeetChannelTyping {
  const store = usePresenceStoreContext();
  const storeRef = useRef<PresenceStore | null>(store);
  storeRef.current = store;

  const typingByChannel = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store ? () => store.getSnapshot().channelTyping : emptySnapshot,
  );

  const heartbeat = useMemo<MeetTypingHeartbeat>(
    () =>
      createMeetTypingHeartbeat({
        send: (channelId) => storeRef.current?.sendChannelTyping(channelId),
        sendStop: (channelId) => storeRef.current?.stopChannelTyping(channelId),
      }),
    [],
  );

  useEffect(() => () => heartbeat.stop(), [heartbeat]);

  const onComposerTyping = useCallback(
    (channelId: string, typing: boolean) => {
      if (typing) heartbeat.keystroke(channelId);
      else heartbeat.stop();
    },
    [heartbeat],
  );

  return { typingByChannel, onComposerTyping };
}
