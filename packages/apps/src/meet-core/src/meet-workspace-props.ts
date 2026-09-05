import type { ReactNode } from "react";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import type { MeetCallStageLayout } from "@/meet-core/src/meet-call-stage-layout";
import type { ChatMessage, MeetChatOperations, MeetUIData } from "@/meet-core/src/meet-types";
import type { MeetThreadCallLayout } from "@/meet-core/src/meet-thread-placement";

export type MeetWorkspaceProps = {
  data: MeetUIData;
  session: WorkspaceSession;
  operations?: MeetChatOperations;
  onLogout?: () => void;
  className?: string;
  initialChannelId?: string;
  initialCallLayout?: MeetCallStageLayout;
  initialThreadId?: string | null;
  /** Room slice for the built-in `MeetCallStage` (stories stub peers; live app passes the real controller). */
  callStageRoom?: MeetCallStageRoomProps;
  /**
   * Live app: channel owning the real RTC session (null = none). Undefined in
   * mock/story trees. Drives layout sync — see `useMeetCallLayout`.
   */
  liveCallChannelId?: string | null;
  /** Live app: selection feed for room-status polling and deep links. */
  onSelectedChannelChange?: (channelId: string | null) => void;
  /** When true, `callStage` fills main on `callChannelId` only. */
  callActive?: boolean;
  /** Channel that owns a story/fixture `callStage` — chrome does not follow channel switches. */
  callChannelId?: string;
  /** Idle / split / fullscreen — reserved for stories; the right rail is always the workspace panel. */
  callLayout?: MeetThreadCallLayout;
  /** Composed `MeetCallStage` (chat slot + room). Built from `callStageRoom` when omitted. */
  callStage?: ReactNode;
  /** Idle-channel chat column. Built from bootstrap messages when omitted. */
  chatColumn?: ReactNode;
  onToggleCall?: () => void;
  threadOpen?: boolean;
  threadMessage?: ChatMessage | null;
  threadReplies?: ChatMessage[];
  /** Override thread chrome (defaults to `ChatThreadPanel`). */
  threadPanel?: ReactNode;
  onOpenThread?: (message: ChatMessage) => void;
  onCloseThread?: () => void;
  onSendThreadReply?: (parentId: string, body: string) => void;
};
