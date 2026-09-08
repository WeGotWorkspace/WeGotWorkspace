import type { MeetControllerState } from "@/meet-core/src/meet-controller-state";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";

/** Device + invite fields shared by `MeetGuestLobby` (live guest/invite). */
export type MeetLobbyPaneProps = {
  controller: MeetControllerState;
  displayName: string;
  inJoinFlow: boolean;
  hasSignedInIdentity: boolean;
  invitedRoom: string | null;
  waitingForAdmission: boolean;
  knockDots: number;
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  activeCamera: string;
  activeMic: string;
  activeSpeaker: string;
  onSpeakerChange: (value: string) => void;
  endedMessage: string | null;
  showMissingInviteScreen: boolean;
  showInviteCheckingScreen: boolean;
  showWaitingForHostScreen: boolean;
  showInviteErrorScreen: boolean;
  canStartReservedRoom: boolean;
  /** Signed-in unauthorized visitors: name is prefilled from the session and not editable. */
  displayNameLocked?: boolean;
};
