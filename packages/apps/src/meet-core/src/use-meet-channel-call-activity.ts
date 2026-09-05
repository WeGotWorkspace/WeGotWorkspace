import { useEffect, useMemo, useState } from "react";
import { meetChannelIdForRoom, meetChannelRoomId } from "@/meet-core/src/meet-channel-room";
import type { MeetAPIOperations, MeetChannel } from "@/meet-core/src/meet-types";

export const MEET_CALL_ACTIVITY_POLL_MS = 5_000;

/** Room-status targets: the selected channel plus the channel with the live RTC session. */
export function meetCallActivityTargets(
  channels: readonly MeetChannel[],
  selectedChannelId: string | null,
  joinedRoomCode: string | null,
): { channelId: string; room: string }[] {
  const targets = new Map<string, string>();
  const selected = channels.find((channel) => channel.id === selectedChannelId);
  if (selected) targets.set(selected.id, meetChannelRoomId(selected));
  const joinedChannelId = meetChannelIdForRoom(channels, joinedRoomCode);
  const joined = channels.find((channel) => channel.id === joinedChannelId);
  if (joined && !targets.has(joined.id)) targets.set(joined.id, meetChannelRoomId(joined));
  return [...targets].map(([channelId, room]) => ({ channelId, room }));
}

function sameActiveSet(prev: Record<string, boolean>, next: Record<string, boolean>): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  return prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key]);
}

/**
 * v1 `callActive` signal (spec: room-status polling, deliberately narrow): polls
 * only the selected channel's room and the channel with an active local session.
 * Flags for channels that leave the poll set are dropped rather than kept stale.
 */
export function useMeetChannelCallActivity({
  operations,
  channels,
  selectedChannelId,
  joinedRoomCode,
  pollMs = MEET_CALL_ACTIVITY_POLL_MS,
}: {
  operations: MeetAPIOperations;
  channels: readonly MeetChannel[];
  selectedChannelId: string | null;
  joinedRoomCode: string | null;
  pollMs?: number;
}): Record<string, boolean> {
  const [active, setActive] = useState<Record<string, boolean>>({});

  const targets = useMemo(
    () => meetCallActivityTargets(channels, selectedChannelId, joinedRoomCode),
    [channels, joinedRoomCode, selectedChannelId],
  );

  useEffect(() => {
    if (targets.length === 0) {
      setActive((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const entries = await Promise.all(
        targets.map(async ({ channelId, room }) => {
          try {
            const status = await operations.roomStatus({ room });
            return [channelId, status.active === true] as const;
          } catch {
            return [channelId, false] as const;
          }
        }),
      );
      if (cancelled) return;
      const next = Object.fromEntries(entries.filter(([, isActive]) => isActive));
      setActive((prev) => (sameActiveSet(prev, next) ? prev : next));
    };
    void poll();
    const id = window.setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [operations, pollMs, targets]);

  return active;
}
