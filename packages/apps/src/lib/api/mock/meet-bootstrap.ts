import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  MeetAppBootstrap,
  MeetChannel,
  MeetDirectoryGroup,
  MeetUIData,
} from "@/meet-core/src/meet-types";
import { DEFAULT_PUBLIC_STUN_URLS_CSV } from "@/lib/rtc/default-stun";
import { DEFAULT_MEET_CHANNEL_COLOR } from "@/meet-core/src/meet-channel-write";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import {
  MEET_CHAT_AUTHOR_PRESENCE,
  MEET_CHAT_DIRECTORY_USERS,
  MEET_CHAT_DM_UNREAD,
  MEET_CHAT_MESSAGES,
  MEET_CHAT_UNFURL,
} from "@/lib/api/mock/meet-chat-fixtures";

export { DEFAULT_MEET_CHANNEL_COLOR };

const DEMO_SESSION: WorkspaceSession = {
  user: {
    displayName: "Demo User",
    initials: "DU",
    username: "demo.user",
    email: "demo@example.com",
  },
  viewerInboxLabel: "me",
};

const DEMO_GROUPS: MeetDirectoryGroup[] = [
  { slug: "editorial", displayName: "Editorial" },
  { slug: "studio", displayName: "Studio" },
];

const DEMO_DIRECTORY: CollectionSharePrincipal[] = [
  ...MEET_CHAT_DIRECTORY_USERS,
  { id: "groups/editorial", displayName: "Editorial", principalType: "group" },
  { id: "groups/studio", displayName: "Studio", principalType: "group" },
];

const DEMO_CHANNELS: MeetChannel[] = [
  {
    id: "channel-general",
    name: "General",
    color: DEFAULT_MEET_CHANNEL_COLOR,
    kind: "channel",
    scope: "personal",
    isSharee: false,
    topic: "Announcements and day-to-day",
    unreadCount: 3,
    memberCount: 6,
    callActive: true,
    shareWith: { "ada.lovelace": { mayRead: true, mayWrite: true } },
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: true, mayDelete: true },
  },
  {
    id: "channel-random",
    name: "Random",
    color: "#a78bfa",
    kind: "channel",
    scope: "personal",
    isSharee: false,
    topic: "Off-topic and asides",
    unreadCount: 12,
    shareWith: null,
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: true, mayDelete: true },
  },
  {
    id: "channel-design",
    name: "Design",
    color: "#38bdf8",
    kind: "channel",
    scope: "personal",
    isSharee: true,
    topic: "Pixels, prototypes and critiques",
    memberCount: 6,
    shareWith: null,
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: false, mayDelete: false },
  },
  {
    id: "channel-shipping",
    name: "Shipping",
    color: "#34d399",
    kind: "channel",
    scope: "personal",
    isSharee: false,
    topic: "Releases and rollout notes",
    unreadCount: 1,
    shareWith: null,
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: true, mayDelete: true },
  },
  {
    id: "meeting-standup",
    name: "Standup",
    color: "#22d3ee",
    kind: "meeting",
    scope: "personal",
    isSharee: false,
    topic: "Daily sync",
    guestAccess: true,
    guestRoomCode: "h8y8-ewp6-al8n",
    shareWith: null,
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: true, mayDelete: true },
  },
  {
    id: "meeting-retro",
    name: "Retro",
    color: "#22d3ee",
    kind: "meeting",
    scope: "personal",
    isSharee: false,
    topic: "Sprint retrospective",
    shareWith: null,
    myRights: { mayReadItems: true, mayWriteAll: true, mayShare: true, mayDelete: true },
  },
];

const DEFAULT_DATA: MeetUIData = {
  defaultDisplayName: "Demo User",
  rtc: {
    stunUrls: DEFAULT_PUBLIC_STUN_URLS_CSV,
    turnUrls: "",
    turnUsername: "",
    turnPassword: "",
    forceRelay: false,
  },
  channels: DEMO_CHANNELS,
  messages: MEET_CHAT_MESSAGES,
  directory: DEMO_DIRECTORY,
  groups: DEMO_GROUPS,
  unfurl: MEET_CHAT_UNFURL,
  authorPresence: MEET_CHAT_AUTHOR_PRESENCE,
  dmUnread: MEET_CHAT_DM_UNREAD,
};

export function createMeetAppBootstrap(overrides?: {
  data?: MeetUIData;
  session?: WorkspaceSession;
}): MeetAppBootstrap {
  return {
    data: overrides?.data ?? DEFAULT_DATA,
    session: overrides?.session ?? DEMO_SESSION,
  };
}
