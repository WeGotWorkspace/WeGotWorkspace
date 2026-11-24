import { useEffect, useMemo, useRef, useState } from "react";
import { meetChannelIdForRoom, meetChannelRoomId } from "@/meet-core/src/meet-channel-room";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";
import {
  useJmapPushConnected,
  useJmapStateChange,
  type JmapPushHubLike,
} from "@/lib/api/wgw/use-jmap-state-change";
import type { MeetAPIOperations, MeetChannel } from "@/lib/models/meet-types";

const NO_OMIT_CHANNEL_IDS: readonly string[] = [];

/** Backup poll, used only while the push stream is down. */
export const MEET_CALL_ACTIVITY_POLL_MS = 5_000;

/** The push type that rings when a call starts or ends in a channel or DM of this user (#2295). */
export const MEET_CALL_PUSH_TYPE = "MeetCall";
const MEET_CALL_PUSH_TYPES: readonly string[] = [MEET_CALL_PUSH_TYPE];

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
 * v1 `callActive` signal (spec: room-status reads, deliberately narrow): reads
 * only the selected channel's room and the channel with an active local session.
 * Flags for channels that leave that set are dropped rather than kept stale.
 *
 * Push is the doorbell (#2295, docs/architecture/jmap-push.md): the room status is read
 * on selection change and whenever the `MeetCall` state changes, and the interval
 * runs only while the push stream is down.
 */
export function useMeetChannelCallActivity({
  operations,
  channels,
  selectedChannelId,
  joinedRoomCode,
  pollMs = MEET_CALL_ACTIVITY_POLL_MS,
  resolveRoom,
  omitChannelIds = NO_OMIT_CHANNEL_IDS,
  pushHub = defaultJmapPushHub(),
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
  /** The browser's push hub; null (mock data) leaves only the interval. */
  pushHub?: JmapPushHubLike | null;
}): Record<string, boolean> {
  const [active, setActive] = useState<Record<string, boolean>>({});
  const omitChannelIdsRef = useRef(omitChannelIds);
  omitChannelIdsRef.current = omitChannelIds;
  // Chat updates (unread counts, read markers) hand a new channel list on every
  // patch; keying the poll on the list restarted it at once each time (shared
  // hosting log: 227 room-status reads a minute). Restart only when the rooms change.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const targetKey = useMemo(
    () =>
      meetCallActivityTargets(channels, selectedChannelId, joinedRoomCode)
        .map(({ channelId, room }) => `${channelId}\u0000${room}`)
        .join("\n"),
    [channels, joinedRoomCode, selectedChannelId],
  );

  useEffect(() => {
    setActive((prev) => {
      const next = omitMeetCallActivityChannels(prev, omitChannelIds);
      return sameActiveSet(prev, next) ? prev : next;
    });
  }, [omitChannelIds]);

  // Resolves false when a read failed, so push offers the state again.
  const pollRef = useRef<() => Promise<boolean>>(async () => true);
  // Numbers the reads: a slower, older read must not overwrite a newer one.
  const pollSeq = useRef(0);
  // A read skipped while the tab was hidden is made up when it shows again.
  const missedWhileHidden = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<boolean> => {
      if (document.hidden) {
        missedWhileHidden.current = true;
        return true;
      }
      missedWhileHidden.current = false;
      const seq = ++pollSeq.current;
      const channels = channelsRef.current;
      const extras: { channelId: string; room: string }[] = [];
      const selectedListed = channels.some((channel) => channel.id === selectedChannelId);
      if (selectedChannelId && resolveRoom && !selectedListed) {
        const room = await resolveRoom(selectedChannelId);
        if (room) extras.push({ channelId: selectedChannelId, room });
      }
      if (cancelled || seq !== pollSeq.current) return true;
      const targets = meetCallActivityTargets(channels, selectedChannelId, joinedRoomCode, extras);
      if (targets.length === 0) {
        setActive((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return true;
      }
      let failed = false;
      const entries = await Promise.all(
        targets.map(async ({ channelId, room }) => {
          try {
            const status = await operations.roomStatus({ room });
            return [channelId, status.active === true] as const;
          } catch {
            failed = true;
            return [channelId, false] as const;
          }
        }),
      );
      if (cancelled || seq !== pollSeq.current) return true;
      // A failed read keeps the previous flags; the caller retries.
      if (failed) return false;
      const next = omitMeetCallActivityChannels(
        Object.fromEntries(entries.filter(([, isActive]) => isActive)),
        omitChannelIdsRef.current,
      );
      setActive((prev) => (sameActiveSet(prev, next) ? prev : next));
      return true;
    };
    pollRef.current = poll;
    void poll();
    return () => {
      cancelled = true;
    };
  }, [targetKey, joinedRoomCode, operations, resolveRoom, selectedChannelId]);

  // Push is the doorbell: a `MeetCall` state change means a call started or ended in one
  // of this user's channels, so the rooms in view are read once.
  const pushConnected = useJmapPushConnected(pushHub);
  useJmapStateChange(MEET_CALL_PUSH_TYPES, () => pollRef.current(), pushHub);

  // The interval is only the backup while push is down.
  useEffect(() => {
    if (pushConnected) return;
    const id = window.setInterval(() => void pollRef.current(), pollMs);
    return () => window.clearInterval(id);
  }, [pushConnected, pollMs]);

  useEffect(() => {
    if (!pushConnected) return;
    const onVisible = () => {
      if (!document.hidden && missedWhileHidden.current) void pollRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pushConnected]);

  return active;
}
