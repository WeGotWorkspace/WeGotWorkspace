import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import type { JmapPushHubLike } from "@/lib/api/wgw/use-jmap-state-change";

/**
 * The push doorbell for signaling rooms (#2294, docs/architecture/jmap-push.md).
 *
 * The browser's push stream carries an `RtcRoom` state that changes when a peer joins or
 * leaves a room this user is in, or a message reaches one of their peers. It says *that*
 * something changed; the room then polls its own mailbox once. While the doorbell is
 * connected and nobody is connecting, a room only polls as a heartbeat below the peer
 * timeout; while it is down, rooms keep their own cadence.
 */
export type RoomDoorbell = {
  /** True while the push stream is connected. */
  readonly connected: boolean;
  /** `onRing` runs when the `RtcRoom` state changes; returns the unsubscribe function. */
  subscribe(onRing: () => void): () => void;
  /** Called when `connected` changes; returns the unsubscribe function. */
  subscribeStatus(listener: (connected: boolean) => void): () => void;
};

export const RTC_ROOM_PUSH_TYPE = "RtcRoom";

/** Adapts a push hub. Null without one (mock data, tests): rooms keep their own polls. */
export function pushRoomDoorbell(
  hub: JmapPushHubLike | null = defaultJmapPushHub(),
): RoomDoorbell | null {
  if (!hub) return null;
  return {
    get connected() {
      return hub.connected;
    },
    subscribe: (onRing) =>
      hub.subscribe([RTC_ROOM_PUSH_TYPE], () => {
        onRing();
        return true;
      }),
    subscribeStatus: (listener) => hub.subscribeStatus(listener),
  };
}
