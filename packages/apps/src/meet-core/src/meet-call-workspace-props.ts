import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { MeetAPIOperations, MeetUIData } from "@/meet-core/src/meet-types";

export type MeetCallWorkspaceProps = {
  data: MeetUIData;
  session: WorkspaceSession;
  operations?: MeetAPIOperations;
  listLoading?: boolean;
  /** Room id from the host route (e.g. `?room=`). */
  invitedRoom?: string | null;
  /** True on `/meet/guest` or `/meet/join` (invite entry), not host `/meet`. */
  isJoinRoute?: boolean;
  /** Builds a guest invite link for the active room; host owns URL shape. */
  buildCallLink?: (roomCode: string) => string;
  /** Emitted when the active room changes; host should sync routing. */
  onRoomChange?: (roomCode: string | null) => void;
  /** Invoked when the user chooses log out; navigation is owned by the app shell. */
  onLogout?: () => void;
  className?: string;
};
