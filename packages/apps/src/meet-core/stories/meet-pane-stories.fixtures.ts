import type { RefObject } from "react";
import type { MeetControllerState } from "@/meet-core/src/meet-controller-state";
import type { MeetChatMessage } from "@/meet-core/src/meet-chat-pane";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";

export const STORY_MEET_DEVICES: MeetDeviceOption[] = [
  { id: "cam-1", label: "FaceTime HD Camera", deviceId: "cam-1" },
  { id: "cam-2", label: "OBS Virtual Camera", deviceId: "cam-2" },
];

export const STORY_MEET_MICROPHONES: MeetDeviceOption[] = [
  { id: "mic-1", label: "MacBook Pro Microphone", deviceId: "mic-1" },
  { id: "mic-2", label: "External USB Mic", deviceId: "mic-2" },
];

export const STORY_MEET_SPEAKERS: MeetDeviceOption[] = [
  { id: "speaker-1", label: "MacBook Pro Speakers", deviceId: "speaker-1" },
  { id: "default", label: "System default" },
];

export const STORY_MEET_KNOCKERS = [
  { id: "guest-1", name: "Alex Morgan" },
  { id: "guest-2", name: "Jamie Lee" },
];

export const STORY_MEET_PEERS = [
  {
    id: "peer-1",
    name: "Alex Morgan",
    stream: null,
    connectionState: "connected" as const,
    remoteMedia: null,
    disclosedMedia: null,
  },
  {
    id: "peer-2",
    name: "Jamie Lee",
    stream: null,
    connectionState: "connected" as const,
    remoteMedia: null,
    disclosedMedia: null,
  },
];

export const STORY_MEET_CHAT_MESSAGES: MeetChatMessage[] = [
  {
    id: "1",
    fromName: "Alex Morgan",
    body: "Can everyone see the deck?",
    ts: Date.now() - 120_000,
  },
  {
    id: "2",
    fromName: "You",
    body: "Yes — sharing now. Link: https://example.com/deck",
    ts: Date.now() - 60_000,
    isSelf: true,
  },
  {
    id: "3",
    fromName: "Jamie Lee",
    body: "Looks good on my side.",
    ts: Date.now() - 30_000,
  },
];

export const STORY_MEET_CALL_LINK =
  "https://workspace.example.com/meet/guest?room=demo-1234-abcd-5678";

const noop = () => {};
const noopAsync = async () => {};

export function createMeetStoryController(
  localVideoRef: RefObject<HTMLVideoElement | null>,
  overrides?: Partial<MeetControllerState>,
): MeetControllerState {
  return {
    status: "in-call",
    error: null,
    roomCode: "demo-1234-abcd-5678",
    selfId: "self-story",
    displayName: "Demo User",
    setDisplayName: noop,
    micOn: true,
    videoOn: true,
    screenOn: false,
    screenPreviewStream: null,
    startedAt: Date.now() - 134_000,
    elapsedLabel: "02:14",
    peers: [],
    knockers: [],
    waitingForAdmission: false,
    endedMessage: null,
    chatMessages: STORY_MEET_CHAT_MESSAGES,
    localVideoRef,
    getLocalStream: () => null,
    audioInputs: [],
    videoInputs: [],
    selectedMicId: "mic-1",
    selectedCamId: "cam-1",
    ensureLocalMedia: noopAsync,
    startMeeting: noopAsync,
    joinRoom: noopAsync,
    requestJoin: noopAsync,
    admitKnocker: noop,
    denyKnocker: noop,
    mutePeer: noop,
    endCallForAll: noopAsync,
    leave: noopAsync,
    sendChat: noop,
    toggleMic: noop,
    toggleVideo: noop,
    setVideoOn: noop,
    toggleScreenShare: noopAsync,
    switchMic: noopAsync,
    switchCamera: noopAsync,
    callLink: STORY_MEET_CALL_LINK,
    inCall: true,
    callActiveInAnotherTab: false,
    ...overrides,
  };
}
