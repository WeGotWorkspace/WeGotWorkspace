/**
 * Sender-side throttle for "typing in channel" signals (chunk K).
 *
 * Composer keystrokes call `keystroke(channelId)` on every edit; the heartbeat
 * broadcasts at most once per `heartbeatMs` (default ~4s) while typing
 * continues. Receivers expire entries after ~6s (presence-store TTL), so a
 * continuous typist never flickers and a stopped one fades out on their own.
 * `stop()` retracts eagerly (send / blur / cleared composer) and resets the
 * throttle so the next keystroke broadcasts immediately.
 *
 * Pure and timer-free: keystrokes drive re-sends, nothing is scheduled.
 */

export const MEET_TYPING_HEARTBEAT_MS = 4000;

export type MeetTypingHeartbeat = {
  keystroke: (channelId: string) => void;
  stop: () => void;
};

export type MeetTypingHeartbeatOptions = {
  send: (channelId: string) => void;
  sendStop: (channelId: string) => void;
  heartbeatMs?: number;
  now?: () => number;
};

export function createMeetTypingHeartbeat(
  options: MeetTypingHeartbeatOptions,
): MeetTypingHeartbeat {
  const heartbeatMs = options.heartbeatMs ?? MEET_TYPING_HEARTBEAT_MS;
  const now = options.now ?? (() => Date.now());
  let activeChannel: string | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;

  return {
    keystroke(channelId: string): void {
      if (!channelId) return;
      if (channelId !== activeChannel) {
        // Switched conversations mid-typing: retract the stale indicator.
        if (activeChannel) options.sendStop(activeChannel);
        activeChannel = channelId;
        lastSentAt = Number.NEGATIVE_INFINITY;
      }
      const at = now();
      if (at - lastSentAt < heartbeatMs) return;
      lastSentAt = at;
      options.send(channelId);
    },
    stop(): void {
      if (activeChannel) options.sendStop(activeChannel);
      activeChannel = null;
      lastSentAt = Number.NEGATIVE_INFINITY;
    },
  };
}
