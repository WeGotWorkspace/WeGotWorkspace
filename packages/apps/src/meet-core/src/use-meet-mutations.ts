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
import { createMeetPeerId, createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import type { MeetCallSessionState } from "@/meet-core/src/use-meet-call-session";
import type { MeetRoomState } from "@/meet-core/src/use-meet-room-state";

export type UseMeetMutationsArgs = {
  room: MeetRoomState;
  session: MeetCallSessionState;
  canModerateKnocks: boolean;
  actingUsername?: string | null;
  leaveRef: MutableRefObject<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)>;
};

export function useMeetMutations({
  room,
  session,
  canModerateKnocks,
  actingUsername,
  leaveRef,
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
    },
    // Room setters/refs are stable; omit the room object to avoid recreating leave every render.
    [meetRtc, stopLocalMedia],
  );
  leaveRef.current = leave;

  const sendLeaveBeacon = useCallback(() => {
    const roomCode = room.roomCodeRef.current;
    const peerId = room.selfIdRef.current;
    if (!roomCode || !peerId) return;
    const payload = JSON.stringify({
      room: roomCode,
      peerId,
      sessionKey: meetRtc.getSessionKey() ?? undefined,
    });
    const endpoint = `/api/v1/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(peerId)}`;
    void fetch(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      // Ignore best-effort unload failures.
    });
  }, [meetRtc, room.roomCodeRef, room.selfIdRef]);

  const joinRoom = useCallback(
    async (roomCode?: string) => {
      const target = (roomCode ?? createMeetRoomCode()).trim().toLowerCase();
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
    },
    [debugRtc, ensureLocalMedia, meetRtc, room],
  );

  const requestJoin = useCallback(
    async (roomCode: string) => {
      const target = roomCode.trim().toLowerCase();
      if (!target) return;
      const peerId = createMeetPeerId(10);
      room.setError(null);
      room.setStatus("preparing");
      room.setRoomCode(target);
      room.setSelfId(peerId);
      room.selfIdRef.current = peerId;
      room.roomCodeRef.current = target;
      room.setChatMessages([]);
      room.setWaitingForAdmission(true);
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
    },
    [ensureLocalMedia, meetRtc, operationsRef, room],
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

  useEffect(() => {
    return () => {
      void leaveRef.current?.();
    };
  }, [leaveRef]);

  useEffect(() => {
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
  }, [room.status]);

  useEffect(() => {
    const onPageHide = () => {
      const active = room.statusRef.current === "in-call" || room.statusRef.current === "waiting";
      if (!active) return;
      sendLeaveBeacon();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [room.statusRef, sendLeaveBeacon]);

  return {
    joinRoom,
    leave,
    requestJoin,
    admitKnocker,
    denyKnocker,
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
