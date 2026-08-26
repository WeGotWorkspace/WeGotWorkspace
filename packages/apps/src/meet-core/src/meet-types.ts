import type { HttpSignalingFetch } from "@/lib/rtc/signaling/http-client";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  WgwMeetChatRequest,
  WgwMeetChatResponse,
  WgwMeetJoinRequest,
  WgwMeetJoinResponse,
  WgwMeetLeaveRequest,
  WgwMeetLeaveResponse,
  WgwMeetPollRequest,
  WgwMeetPollResponse,
  WgwMeetPatchRoomRequest,
  WgwMeetReserveRoomRequest,
  WgwMeetRoomStatusRequest,
  WgwMeetRoomStatusResponse,
  WgwMeetSendRequest,
  WgwMeetSendResponse,
} from "@/lib/api/wgw/types";
import type { RtcSettings } from "@/lib/rtc/types";

export type MeetRtcSettings = RtcSettings;

export type MeetUIData = {
  defaultDisplayName: string;
  rtc: MeetRtcSettings;
};

export type MeetAppBootstrap = {
  session: WorkspaceSession;
  data: MeetUIData;
};

export type MeetRequestOptions = {
  signal?: AbortSignal;
};

export type MeetAPIOperations = {
  roomStatus: (
    input: WgwMeetRoomStatusRequest,
    opts?: MeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  reserveRoom?: (
    input: WgwMeetReserveRoomRequest,
    opts?: MeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  patchRoomExpiresAt?: (
    input: WgwMeetPatchRoomRequest,
    opts?: MeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  join: (input: WgwMeetJoinRequest, opts?: MeetRequestOptions) => Promise<WgwMeetJoinResponse>;
  poll: (input: WgwMeetPollRequest, opts?: MeetRequestOptions) => Promise<WgwMeetPollResponse>;
  send: (input: WgwMeetSendRequest, opts?: MeetRequestOptions) => Promise<WgwMeetSendResponse>;
  leave: (input: WgwMeetLeaveRequest, opts?: MeetRequestOptions) => Promise<WgwMeetLeaveResponse>;
  chat: (input: WgwMeetChatRequest, opts?: MeetRequestOptions) => Promise<WgwMeetChatResponse>;
  /** Guest RTC signaling when the session has no auth token (wired in meet-api-source). */
  guestSignalingFetch?: () => HttpSignalingFetch;
};
