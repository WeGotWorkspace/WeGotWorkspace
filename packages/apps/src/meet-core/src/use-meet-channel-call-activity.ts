import { useEffect, useRef, useState } from "react";
import { meetChannelIdForRoom, meetChannelRoomId } from "@/meet-core/src/meet-channel-room";
import type { MeetAPIOperations, MeetChannel } from "@/meet-core/src/meet-types";

const NO_OMIT_CHANNEL_IDS: readonly string[] = [];

export const MEET_CALL_ACTIVITY_POLL_MS = 5_000;

/** Room-status targets: the selected channel plus the channel with the live RTC session. */
export function meetCallActivityTargets(
  channels: readonly MeetChannel[],
  selectedChannelId: string | null,
  joinedRoomCode: string | null,
  extras: readonly { channelId: string; room: string }[] = [],
): { channelId: string; room: string }[] {
  const targets = new Map<string, string>();
  const selected = channels.find((channel) => channel.id === selectedChannelId);
  if (selected) targets.set(selected.id, meetChannelRoomId(selected));
  const joinedChannelId = meetChannelIdForRoom(channels, joinedRoomCode);
  const joined = channels.find((channel) => channel.id === joinedChannelId);
  if (joined && !targets.has(joined.id)) targets.set(joined.id, meetChannelRoomId(joined));
  for (const extra of extras) {
    if (!extra.channelId || !extra.room || targets.has(extra.channelId)) continue;
    targets.set(extra.channelId, extra.room);
  }
  return [...targets].map(([channelId, room]) => ({ channelId, room }));
}

function sameActiveSet(prev: Record<string, boolean>, next: Record<string, boolean>): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  return prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key]);
}

/** Drop poll-true flags for channels mesh has already emptied (stale room-status). */
export function omitMeetCallActivityChannels(
  active: Record<string, boolean>,
  omitIds: readonly string[],
): Record<string, boolean> {
  if (omitIds.length === 0) return active;
  const omit = new Set(omitIds);
  let omitted = false;
  const out: Record<string, boolean> = {};
  for (const [id, isActive] of Object.entries(active)) {
    if (isActive && omit.has(id)) {
      omitted = true;
      continue;
    }
    if (isActive) out[id] = true;
  }
  return omitted ? out : active;
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
  resolveRoom,
  omitChannelIds = NO_OMIT_CHANNEL_IDS,
}: {
  operations: MeetAPIOperations;
  channels: readonly MeetChannel[];
  selectedChannelId: string | null;
  joinedRoomCode: string | null;
  pollMs?: number;
  /** Room code for a selected id that is not in `channels` (virtual `dm:{peer}`). */
  resolveRoom?: (channelId: string) => Promise<string | null>;
  /** Mesh-emptied channel ids — drop immediately and ignore stale poll `true`. */
  omitChannelIds?: readonly string[];
}): Record<string, boolean> {
  const [active, setActive] = useState<Record<string, boolean>>({});
  const omitChannelIdsRef = useRef(omitChannelIds);
  omitChannelIdsRef.current = omitChannelIds;

  useEffect(() => {
    setActive((prev) => {
      const next = omitMeetCallActivityChannels(prev, omitChannelIds);
      return sameActiveSet(prev, next) ? prev : next;
    });
  }, [omitChannelIds]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const extras: { channelId: string; room: string }[] = [];
      const selectedListed = channels.some((channel) => channel.id === selectedChannelId);
      if (selectedChannelId && resolveRoom && !selectedListed) {
        const room = await resolveRoom(selectedChannelId);
        if (room) extras.push({ channelId: selectedChannelId, room });
      }
      if (cancelled) return;
      const targets = meetCallActivityTargets(channels, selectedChannelId, joinedRoomCode, extras);
      if (targets.length === 0) {
        setActive((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
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
      const next = omitMeetCallActivityChannels(
        Object.fromEntries(entries.filter(([, isActive]) => isActive)),
        omitChannelIdsRef.current,
      );
      setActive((prev) => (sameActiveSet(prev, next) ? prev : next));
    };
    void poll();
    const id = window.setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [channels, joinedRoomCode, operations, pollMs, resolveRoom, selectedChannelId]);

  return active;
}
