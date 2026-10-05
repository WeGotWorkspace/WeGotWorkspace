import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";
import {
  appendMeetRoomChatLine,
  meetPollChatLine,
  type MeetChatLine,
} from "@/meet-core/src/meet-chat-line";
import {
  parseMeetControlMessage,
  type MeetControlMessage,
} from "@/meet-core/src/meet-control-messages";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { completeMeetKnockAdmission } from "@/meet-core/src/meet-knock-admission";
import {
  buildActiveMeetRoster,
  buildMeetSignalingRoster,
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

type RosterPeer = { id: string; user?: string };

/** Host commands. Knock announcements and media presence are not in this set. */
const HOST_CONTROL_KINDS = new Set<MeetControlMessage["kind"]>([
  "admit",
  "deny",
  "end",
  "mute",
  "unmute",
]);

/**
 * Authenticated polls include `user` on account peers and omit it on guests.
 * Honour host commands only from an account. Guest polls strip every account
 * name, so this client cannot tell; the server already refused the rest.
 */
function hostControlSenderIsTrusted(
  peers: readonly RosterPeer[],
  from: string,
  viewerSeesAccounts: boolean,
): boolean {
  if (!viewerSeesAccounts) return true;
  const sender = peers.find((peer) => peer.id === from);
  return typeof sender?.user === "string" && sender.user.length > 0;
}

export type UseMeetPollHandlerArgs = {
  selfIdRef: MutableRefObject<string | null>;
  statusRef: MutableRefObject<CallStatus>;
  roomCodeRef: MutableRefObject<string | null>;
  displayNameRef: MutableRefObject<string>;
  waitingForAdmissionRef: MutableRefObject<boolean>;
  rosterRef: MutableRefObject<Map<string, string>>;
  /** Raw roster for the offer gate — knock rows included. */
  signalingRosterRef: MutableRefObject<Map<string, string>>;
  participantRosterDiffReadyRef: MutableRefObject<boolean>;
  peerNamesRef: MutableRefObject<Map<string, string>>;
  peerDisclosedMediaRef: MutableRefObject<
    Map<string, { mic: boolean; camera: boolean; screen?: boolean }>
  >;
  refreshPeersRef: MutableRefObject<() => void>;
  leaveRef: MutableRefObject<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)>;
  meetRtcRef: MutableRefObject<MeetRtc | null>;
  muteMicRef: MutableRefObject<null | (() => boolean)>;
  /**
   * Signed-in polls disclose account names on the roster. Guest polls do not,
   * so they cannot apply the same sender check.
   */
  viewerSeesAccounts: boolean;
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
  signalingRosterRef,
  participantRosterDiffReadyRef,
  peerNamesRef,
  peerDisclosedMediaRef,
  refreshPeersRef,
  leaveRef,
  meetRtcRef,
  muteMicRef,
  viewerSeesAccounts,
  setKnockers,
  setEndedMessage,
  setStatus,
  setStartedAt,
  setWaitingForAdmission,
  setChatMessages,
}: UseMeetPollHandlerArgs) {
  const toast = useAppToast();
  return useCallback(
    async (poll: HttpSignalingPollResult) => {
      const roster = poll.peers ?? [];
      const incoming = (poll.messages ?? []) as MeetPollMessage[];
      const selfPeerId = selfIdRef.current;
      if (!selfPeerId) return;

      // Before the signals of this same poll are applied: the offer gate reads it.
      signalingRosterRef.current = buildMeetSignalingRoster(roster);

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
            toast.showSuccess(meetLabels.participantJoined(name));
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
          if (
            HOST_CONTROL_KINDS.has(control.kind) &&
            !hostControlSenderIsTrusted(roster, msg.from, viewerSeesAccounts)
          ) {
            continue;
          }
          if (control.kind === "knock") {
            setKnockers((prev) => {
              if (prev.some((entry) => entry.id === control.peerId)) return prev;
              return [...prev, { id: control.peerId, name: control.name }];
            });
          }
          if (control.kind === "end") {
            if (statusRef.current === "in-call") {
              setEndedMessage(meetLabels.callEndedBy(control.by));
              toast.show(meetLabels.callEndedBy(control.by), { severity: "info" });
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
          if (control.kind === "mute" || control.kind === "unmute") {
            // Remote unmute used to force `track.enabled = true`. That stays
            // off until a consent UI exists; mute is still applied.
            if (
              control.kind === "mute" &&
              control.peerId === selfPeerId &&
              muteMicRef.current?.()
            ) {
              toast.show(meetLabels.mutedByHost, { severity: "info" });
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
              onAdmitted: () => toast.showSuccess(meetLabels.youWereLetIn),
              onRtcReady: () => meetRtcRef.current?.retryRoomPeerConnections(),
            });
          } else if (control.kind === "deny") {
            toast.showError(meetLabels.joinDenied);
            await leaveRef.current?.();
          }
          continue;
        }
        const fromName = roster.find((peer) => peer.id === msg.from)?.name ?? "Peer";
        setChatMessages((prev) =>
          appendMeetRoomChatLine(prev, meetPollChatLine(msg.from, fromName, text, selfPeerId)),
        );
      }
    },
    [
      displayNameRef,
      leaveRef,
      meetRtcRef,
      muteMicRef,
      viewerSeesAccounts,
      participantRosterDiffReadyRef,
      peerDisclosedMediaRef,
      peerNamesRef,
      refreshPeersRef,
      roomCodeRef,
      rosterRef,
      selfIdRef,
      signalingRosterRef,
      setChatMessages,
      setEndedMessage,
      setKnockers,
      setStartedAt,
      setStatus,
      setWaitingForAdmission,
      statusRef,
      toast,
      waitingForAdmissionRef,
    ],
  );
}
