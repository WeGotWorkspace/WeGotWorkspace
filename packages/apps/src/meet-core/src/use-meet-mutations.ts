import { useCallback, useEffect, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import {
  buildMeetControlMessage,
  encodeMeetKnockerName,
} from "@/meet-core/src/meet-control-messages";
import { buildLocalMeetChatLine } from "@/meet-core/src/meet-chat-line";
import {
  MEET_AD_HOC_RESERVATION_TTL_MS,
  meetActorPrincipal,
} from "@/meet-core/src/meet-invite-status";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { sendMeetLeaveBeacon } from "@/meet-core/src/meet-leave-beacon";
import { meetJoinAlreadyEngaged } from "@/meet-core/src/meet-join-reuse";
import { createMeetPeerId, createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import type { MeetCallSessionState } from "@/meet-core/src/use-meet-call-session";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";

export type UseMeetMutationsArgs = {
  room: MeetRoomState;
  session: MeetCallSessionState;
  canModerateKnocks: boolean;
  actingUsername?: string | null;
  leaveRef: MutableRefObject<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)>;
  /**
   * True when a suite-level call store keeps the call alive across route unmounts.
   * Skips the unmount leave and the page-level handlers (owned by `MeetCallProvider`).
   */
  persistentCall?: boolean;
};

export function useMeetMutations({
  room,
  session,
  canModerateKnocks,
  actingUsername,
  leaveRef,
  persistentCall = false,
}: UseMeetMutationsArgs) {
  const { meetRtc, operationsRef, debugRtc, ensureLocalMedia, stopLocalMedia } = session;

  const leave = useCallback(
    async (opts?: { preserveEndedMessage?: boolean }) => {
      await meetRtc.leave();
      stopLocalMedia();

      room.setStatus("idle");
      room.setRoomCode(null);
      room.setSelfId(null);
      room.setStartedAt(null);
      room.setElapsedSeconds(0);
      room.resetIdleMediaDefaults();
      room.setPeers([]);
      room.setChatMessages([]);
      room.setWaitingForAdmission(false);
      room.setKnockers([]);
      if (!opts?.preserveEndedMessage) {
        room.setEndedMessage(null);
      }
      room.resetPeerMaps();
      room.roomCodeRef.current = null;
      room.selfIdRef.current = null;
      if (room.joinInFlightRef) room.joinInFlightRef.current = null;
    },
    // Room setters/refs are stable; omit the room object to avoid recreating leave every render.
    [meetRtc, stopLocalMedia],
  );
  leaveRef.current = leave;

  const sendLeaveBeacon = useCallback(() => {
    const roomCode = room.roomCodeRef.current;
    const peerId = room.selfIdRef.current;
    if (!roomCode || !peerId) return;
    sendMeetLeaveBeacon({ roomCode, peerId, sessionKey: meetRtc.getSessionKey() });
  }, [meetRtc, room.roomCodeRef, room.selfIdRef]);

  const warnIfCallActiveElsewhere = useCallback(() => {
    if (room.remoteCallActiveRef?.current) {
      toast.info(meetLabels.callActiveInAnotherTab);
    }
  }, [room.remoteCallActiveRef]);

  const runSerializedJoin = useCallback(
    async (work: () => Promise<void>) => {
      const slot = room.joinInFlightRef ?? { current: null };
      const previous = slot.current;
      let release = (): void => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      slot.current = current;
      try {
        if (previous) await previous.catch(() => undefined);
        await work();
      } finally {
        release();
        if (slot.current === current) slot.current = null;
      }
    },
    [room.joinInFlightRef],
  );

  const joinRoom = useCallback(
    async (roomCode?: string, options?: { video?: boolean }) => {
      warnIfCallActiveElsewhere();
      if (options?.video === false) room.setVideoOn(false);
      const target = (roomCode ?? createMeetRoomCode()).trim().toLowerCase();

      await runSerializedJoin(async () => {
        if (meetJoinAlreadyEngaged(room.statusRef.current, room.roomCodeRef.current, target)) {
          debugRtc("join-room-reuse", { room: target, peerId: room.selfIdRef.current });
          return;
        }
        const peerId = createMeetPeerId(10);
        room.setError(null);
        room.setStatus("preparing");
        room.setRoomCode(target);
        room.setSelfId(peerId);
        room.selfIdRef.current = peerId;
        room.roomCodeRef.current = target;
        room.setChatMessages([]);
        room.setWaitingForAdmission(false);
        room.setKnockers([]);
        room.setEndedMessage(null);
        room.resetPeerMaps();

        try {
          debugRtc("join-room-start", { room: target, peerId });
          await ensureLocalMedia();
          await meetRtc.join({
            room: target,
            peerId,
            name: room.displayNameRef.current.trim() || "Guest",
          });
          room.setStatus("in-call");
          room.setStartedAt(Date.now());
          debugRtc("join-room-success", { room: target, peerId });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not join meeting.";
          debugRtc("join-room-failed", { room: target, peerId, message });
          room.setStatus("failed");
          room.setError(message);
          throw e;
        }
      });
    },
    [debugRtc, ensureLocalMedia, meetRtc, room, runSerializedJoin, warnIfCallActiveElsewhere],
  );

  const requestJoin = useCallback(
    async (roomCode: string) => {
      const target = roomCode.trim().toLowerCase();
      if (!target) return;
      warnIfCallActiveElsewhere();

      await runSerializedJoin(async () => {
        if (meetJoinAlreadyEngaged(room.statusRef.current, room.roomCodeRef.current, target)) {
          return;
        }
        const peerId = createMeetPeerId(10);
        room.setError(null);
        room.setWaitingForAdmission(true);
        room.setStatus("preparing");
        room.setRoomCode(target);
        room.setSelfId(peerId);
        room.selfIdRef.current = peerId;
        room.roomCodeRef.current = target;
        room.setChatMessages([]);
        room.setKnockers([]);
        room.setEndedMessage(null);
        room.resetPeerMaps();

        try {
          await ensureLocalMedia();
          await meetRtc.join({
            room: target,
            peerId,
            name: encodeMeetKnockerName(room.displayNameRef.current),
          });
          if (operationsRef.current) {
            await operationsRef.current.chat({
              room: target,
              from: peerId,
              text: buildMeetControlMessage({
                kind: "knock",
                peerId,
                name: room.displayNameRef.current.trim() || "Guest",
              }),
              sessionKey: meetRtc.getSessionKey() ?? undefined,
            });
          }
          room.setStatus("waiting");
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not request to join.";
          room.setStatus("failed");
          room.setError(message);
          room.setWaitingForAdmission(false);
          throw e;
        }
      });
    },
    [ensureLocalMedia, meetRtc, operationsRef, room, runSerializedJoin, warnIfCallActiveElsewhere],
  );

  const admitKnocker = useCallback(
    async (peerId: string) => {
      if (!canModerateKnocks) return;
      if (!operationsRef.current || !room.roomCodeRef.current || !room.selfIdRef.current) return;
      await operationsRef.current.chat({
        room: room.roomCodeRef.current,
        from: room.selfIdRef.current,
        text: buildMeetControlMessage({ kind: "admit", peerId }),
        sessionKey: meetRtc.getSessionKey() ?? undefined,
      });
      room.setKnockers((prev) => prev.filter((entry) => entry.id !== peerId));
    },
    [canModerateKnocks, meetRtc, operationsRef, room],
  );

  const denyKnocker = useCallback(
    async (peerId: string) => {
      if (!canModerateKnocks) return;
      if (!operationsRef.current || !room.roomCodeRef.current || !room.selfIdRef.current) return;
      await operationsRef.current.chat({
        room: room.roomCodeRef.current,
        from: room.selfIdRef.current,
        text: buildMeetControlMessage({ kind: "deny", peerId }),
        sessionKey: meetRtc.getSessionKey() ?? undefined,
      });
      room.setKnockers((prev) => prev.filter((entry) => entry.id !== peerId));
    },
    [canModerateKnocks, meetRtc, operationsRef, room],
  );

  const mutePeer = useCallback(
    async (peerId: string) => {
      if (!canModerateKnocks) return;
      if (!operationsRef.current || !room.roomCodeRef.current || !room.selfIdRef.current) return;
      if (peerId === room.selfIdRef.current) return;
      try {
        await operationsRef.current.chat({
          room: room.roomCodeRef.current,
          from: room.selfIdRef.current,
          text: buildMeetControlMessage({ kind: "mute", peerId }),
          sessionKey: meetRtc.getSessionKey() ?? undefined,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : meetLabels.couldNotMuteParticipant);
      }
    },
    [canModerateKnocks, meetRtc, operationsRef, room],
  );

  const endCallForAll = useCallback(async () => {
    if (!operationsRef.current || !room.roomCodeRef.current || !room.selfIdRef.current) {
      await leave();
      return;
    }
    try {
      await operationsRef.current.chat({
        room: room.roomCodeRef.current,
        from: room.selfIdRef.current,
        text: buildMeetControlMessage({
          kind: "end",
          by: room.displayNameRef.current.trim() || "Host",
        }),
        sessionKey: meetRtc.getSessionKey() ?? undefined,
      });
    } catch {
      // Continue with local leave even if broadcast fails.
    }
    await leave();
  }, [leave, meetRtc, operationsRef, room]);

  const sendChat = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text) return;
      const me = room.selfIdRef.current;
      if (!me || !room.roomCodeRef.current) return;

      const localLine = buildLocalMeetChatLine(
        me,
        room.displayNameRef.current.trim() || "You",
        text,
      );
      room.setChatMessages((prev) => [...prev, localLine]);

      if (!operationsRef.current) return;
      try {
        await operationsRef.current.chat({
          room: room.roomCodeRef.current,
          from: me,
          text,
          sessionKey: meetRtc.getSessionKey() ?? undefined,
        });
      } catch (e) {
        room.setChatMessages((prev) => prev.filter((line) => line.id !== localLine.id));
        toast.error(e instanceof Error ? e.message : "Could not send message.");
      }
    },
    [meetRtc, operationsRef, room],
  );

  const startMeeting = useCallback(async () => {
    const target = createMeetRoomCode();
    const reserve = operationsRef.current?.reserveRoom;
    const username = actingUsername?.trim();
    if (reserve && username) {
      await reserve({
        room: target,
        ownerPrincipal: meetActorPrincipal(username),
        expiresAt: new Date(Date.now() + MEET_AD_HOC_RESERVATION_TTL_MS).toISOString(),
      });
    }
    await joinRoom(target);
  }, [actingUsername, joinRoom, operationsRef]);

  // With a suite-level call store the call survives route unmounts; page-level
  // leave behavior (beforeunload/pagehide) is owned by MeetCallProvider instead.
  useEffect(() => {
    if (persistentCall) return;
    return () => {
      void leaveRef.current?.();
    };
  }, [leaveRef, persistentCall]);

  useEffect(() => {
    if (persistentCall) return;
    const isMeetingActive =
      room.status === "in-call" || room.status === "preparing" || room.status === "waiting";
    if (!isMeetingActive) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistentCall, room.status]);

  useEffect(() => {
    if (persistentCall) return;
    const onPageHide = () => {
      const active = room.statusRef.current === "in-call" || room.statusRef.current === "waiting";
      if (!active) return;
      sendLeaveBeacon();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [persistentCall, room.statusRef, sendLeaveBeacon]);

  return {
    joinRoom,
    leave,
    requestJoin,
    admitKnocker,
    denyKnocker,
    mutePeer,
    endCallForAll,
    sendChat,
    startMeeting,
    sendLeaveBeacon,
  };
}

export type MeetMutationsState = ReturnType<typeof useMeetMutations>;

export function meetCanModerateKnocks(session: WorkspaceSession): boolean {
  return Boolean(session.user.username?.trim() || session.user.email?.trim());
}
