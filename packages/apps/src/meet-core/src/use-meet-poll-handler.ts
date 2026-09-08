import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import type { HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";
import { parseMeetControlMessage } from "@/meet-core/src/meet-control-messages";
import { buildMeetChatLineFromPoll, type MeetChatLine } from "@/meet-core/src/meet-chat-line";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { completeMeetKnockAdmission } from "@/meet-core/src/meet-knock-admission";
import {
  buildActiveMeetRoster,
  listKnockersFromRoster,
  listNewParticipantNames,
  type MeetKnocker,
} from "@/meet-core/src/meet-poll-roster";
import type { useMeetRtc } from "@/meet-core/src/use-meet-rtc";

type MeetRtc = ReturnType<typeof useMeetRtc>;
type CallStatus = "idle" | "preparing" | "waiting" | "in-call" | "failed";
type SignalType = "offer" | "answer" | "ice" | "bye" | "chat";

type MeetPollMessage = {
  from: string;
  type: SignalType;
  payload: unknown;
};

export type UseMeetPollHandlerArgs = {
  selfIdRef: MutableRefObject<string | null>;
  statusRef: MutableRefObject<CallStatus>;
  roomCodeRef: MutableRefObject<string | null>;
  displayNameRef: MutableRefObject<string>;
  waitingForAdmissionRef: MutableRefObject<boolean>;
  rosterRef: MutableRefObject<Map<string, string>>;
  participantRosterDiffReadyRef: MutableRefObject<boolean>;
  peerNamesRef: MutableRefObject<Map<string, string>>;
  peerDisclosedMediaRef: MutableRefObject<
    Map<string, { mic: boolean; camera: boolean; screen?: boolean }>
  >;
  refreshPeersRef: MutableRefObject<() => void>;
  leaveRef: MutableRefObject<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)>;
  meetRtcRef: MutableRefObject<MeetRtc | null>;
  muteMicRef: MutableRefObject<null | (() => boolean)>;
  setKnockers: Dispatch<SetStateAction<MeetKnocker[]>>;
  setEndedMessage: Dispatch<SetStateAction<string | null>>;
  setStatus: Dispatch<SetStateAction<CallStatus>>;
  setStartedAt: Dispatch<SetStateAction<number | null>>;
  setWaitingForAdmission: Dispatch<SetStateAction<boolean>>;
  setChatMessages: Dispatch<SetStateAction<MeetChatLine[]>>;
};

export function useMeetPollHandler({
  selfIdRef,
  statusRef,
  roomCodeRef,
  displayNameRef,
  waitingForAdmissionRef,
  rosterRef,
  participantRosterDiffReadyRef,
  peerNamesRef,
  peerDisclosedMediaRef,
  refreshPeersRef,
  leaveRef,
  meetRtcRef,
  muteMicRef,
  setKnockers,
  setEndedMessage,
  setStatus,
  setStartedAt,
  setWaitingForAdmission,
  setChatMessages,
}: UseMeetPollHandlerArgs) {
  return useCallback(
    async (poll: HttpSignalingPollResult) => {
      const roster = poll.peers ?? [];
      const incoming = (poll.messages ?? []) as MeetPollMessage[];
      const selfPeerId = selfIdRef.current;
      if (!selfPeerId) return;

      const pendingKnockers = listKnockersFromRoster(roster);
      setKnockers((prev) => {
        if (
          prev.length === pendingKnockers.length &&
          prev.every((entry, index) => entry.id === pendingKnockers[index]?.id)
        ) {
          return prev;
        }
        return pendingKnockers;
      });
      const pendingKnockerIds = new Set(pendingKnockers.map((peer) => peer.id));
      const activeRoster = buildActiveMeetRoster(roster, pendingKnockerIds);
      for (const [id, name] of activeRoster) {
        peerNamesRef.current.set(id, name);
      }
      if (statusRef.current === "in-call") {
        if (!participantRosterDiffReadyRef.current) {
          participantRosterDiffReadyRef.current = true;
          rosterRef.current = activeRoster;
        } else {
          for (const name of listNewParticipantNames(rosterRef.current, activeRoster, selfPeerId)) {
            toast.success(meetLabels.participantJoined(name));
          }
          rosterRef.current = activeRoster;
        }
      } else {
        rosterRef.current = activeRoster;
      }

      for (const msg of incoming) {
        if (msg.type !== "chat") continue;
        const text = (msg.payload as { text?: unknown } | null)?.text;
        if (typeof text !== "string" || text.trim() === "") continue;
        const control = parseMeetControlMessage(text.trim());
        if (control) {
          if (control.kind === "knock") {
            setKnockers((prev) => {
              if (prev.some((entry) => entry.id === control.peerId)) return prev;
              return [...prev, { id: control.peerId, name: control.name }];
            });
          }
          if (control.kind === "end") {
            if (statusRef.current === "in-call") {
              setEndedMessage(`Call ended by ${control.by}.`);
              toast.info(`Call ended by ${control.by}.`);
              await leaveRef.current?.({ preserveEndedMessage: true });
            }
            continue;
          }
          if (control.kind === "media") {
            if (msg.from !== selfPeerId) {
              peerDisclosedMediaRef.current.set(msg.from, {
                mic: control.mic,
                camera: control.camera,
                screen: control.screen,
              });
              refreshPeersRef.current();
            }
            continue;
          }
          if (control.kind === "mute") {
            if (control.peerId === selfPeerId && muteMicRef.current?.()) {
              toast.info(meetLabels.mutedByHost);
            }
            continue;
          }
          if (control.kind !== "admit" && control.kind !== "deny") continue;
          if (control.peerId !== selfPeerId) continue;
          if (control.kind === "admit") {
            await completeMeetKnockAdmission({
              waiting: waitingForAdmissionRef.current,
              roomCode: roomCodeRef.current,
              selfPeerId,
              displayName: displayNameRef.current,
              updateJoinName: meetRtcRef.current
                ? (name) => meetRtcRef.current!.updateJoinName(name)
                : undefined,
              setWaitingForAdmission: (value) => {
                waitingForAdmissionRef.current = value;
                setWaitingForAdmission(value);
              },
              setStatus: (status) => setStatus(status),
              setStartedAt: (value) => setStartedAt(value),
              onAdmitted: () => toast.success("You were let in."),
            });
          } else if (control.kind === "deny") {
            toast.error("The host denied your request to join.");
            await leaveRef.current?.();
          }
          continue;
        }
        const fromName = roster.find((peer) => peer.id === msg.from)?.name ?? "Peer";
        setChatMessages((prev) => [
          ...prev,
          buildMeetChatLineFromPoll(msg.from, fromName, text, selfPeerId),
        ]);
      }
    },
    [
      displayNameRef,
      leaveRef,
      meetRtcRef,
      muteMicRef,
      participantRosterDiffReadyRef,
      peerDisclosedMediaRef,
      peerNamesRef,
      refreshPeersRef,
      roomCodeRef,
      rosterRef,
      selfIdRef,
      setChatMessages,
      setEndedMessage,
      setKnockers,
      setStartedAt,
      setStatus,
      setWaitingForAdmission,
      statusRef,
      waitingForAdmissionRef,
    ],
  );
}
