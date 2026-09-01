import type { ChatAuthorPresenceMap } from "@/chat-ui/src/chat-types";
import { mapChatPreviews } from "@/meet-core/src/meet-chat-urls";
import { meetDirectMessageChannelId } from "@/meet-core/src/meet-direct-messages";
import type {
  ChatMessage,
  ChatMention,
  ChatReaction,
  MeetUnfurlMap,
} from "@/meet-core/src/meet-types";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

const GENERAL = "channel-general";

export const MEET_CHAT_AUTHORS = {
  ada: { id: "ada.lovelace", displayName: "Ada Lovelace" },
  grace: { id: "grace.hopper", displayName: "Grace Hopper" },
  demo: { id: "demo.user", displayName: "Demo User" },
  alan: { id: "alan.turing", displayName: "Alan Turing" },
  katherine: { id: "katherine.johnson", displayName: "Katherine Johnson" },
  margaret: { id: "margaret.hamilton", displayName: "Margaret Hamilton" },
} as const;

type MeetChatAuthor = (typeof MEET_CHAT_AUTHORS)[keyof typeof MEET_CHAT_AUTHORS];

export const MEET_CHAT_DIRECTORY_USERS: CollectionSharePrincipal[] = [
  {
    id: MEET_CHAT_AUTHORS.ada.id,
    displayName: MEET_CHAT_AUTHORS.ada.displayName,
    principalType: "user",
  },
  {
    id: MEET_CHAT_AUTHORS.grace.id,
    displayName: MEET_CHAT_AUTHORS.grace.displayName,
    principalType: "user",
  },
  {
    id: MEET_CHAT_AUTHORS.alan.id,
    displayName: MEET_CHAT_AUTHORS.alan.displayName,
    principalType: "user",
  },
  {
    id: MEET_CHAT_AUTHORS.katherine.id,
    displayName: MEET_CHAT_AUTHORS.katherine.displayName,
    principalType: "user",
  },
  {
    id: MEET_CHAT_AUTHORS.margaret.id,
    displayName: MEET_CHAT_AUTHORS.margaret.displayName,
    principalType: "user",
  },
];

export const MEET_CHAT_AUTHOR_PRESENCE: ChatAuthorPresenceMap = {
  [MEET_CHAT_AUTHORS.ada.id]: "online",
  [MEET_CHAT_AUTHORS.grace.id]: "offline",
  [MEET_CHAT_AUTHORS.demo.id]: "online",
  [MEET_CHAT_AUTHORS.alan.id]: "online",
  [MEET_CHAT_AUTHORS.katherine.id]: "away",
  [MEET_CHAT_AUTHORS.margaret.id]: "online",
};

/** Story unread pills on 1–2 directory people — not a live product signal. */
export const MEET_CHAT_DM_UNREAD: Record<string, number> = {
  [MEET_CHAT_AUTHORS.ada.id]: 2,
  [MEET_CHAT_AUTHORS.katherine.id]: 1,
};

export const MEET_CHAT_UNFURL: MeetUnfurlMap = {
  "https://docs.example.com/notes/sprint": {
    url: "https://docs.example.com/notes/sprint",
    kind: "internal-docs",
    title: "Sprint notes",
    docsId: "doc-sprint",
    content: "# Sprint notes\n\nShip **chat** and voice in the same workspace.",
  },
  "https://drive.example.com/files/brief": {
    url: "https://drive.example.com/files/brief",
    kind: "internal-file",
    title: "Brief.pdf",
    fileId: "file-brief",
  },
  "https://example.com/blog": {
    url: "https://example.com/blog",
    kind: "external",
    title: "Example blog",
    description: "A fixture OG card",
    siteName: "example.com",
  },
};

function mentionOf(author: MeetChatAuthor): ChatMention {
  return { id: author.id, displayName: author.displayName };
}

function message(
  id: string,
  author: MeetChatAuthor,
  body: string,
  createdAt: string,
  extra?: {
    channelId?: string;
    reactions?: ChatReaction[];
    mentions?: ChatMention[];
    replyCount?: number;
    parentId?: string;
    threadId?: string;
  },
): ChatMessage {
  const parentId = extra?.parentId;
  return {
    id,
    channelId: extra?.channelId ?? GENERAL,
    authorId: author.id,
    authorName: author.displayName,
    body,
    createdAt: Date.parse(createdAt),
    reactions: extra?.reactions ?? [],
    mentions: extra?.mentions ?? [],
    previews: mapChatPreviews(body, MEET_CHAT_UNFURL),
    replyCount: extra?.replyCount,
    parentId,
    threadId: parentId ? (extra.threadId ?? parentId) : undefined,
  };
}

const { ada, grace, demo, alan, katherine, margaret } = MEET_CHAT_AUTHORS;

/** Dense #general history for Storybook (Yesterday + Today). Thread open uses `msg-1`. */
export const MEET_CHAT_MESSAGES: ChatMessage[] = [
  message(
    "msg-g01",
    ada,
    "Wrapping the afternoon — still need eyes on the composer keyboard path before we call it.",
    "2026-08-31T13:05:00.000Z",
  ),
  message("msg-g02", grace, "I can take a pass after dinner.", "2026-08-31T13:07:00.000Z"),
  message("msg-g03", alan, "Same.", "2026-08-31T13:08:00.000Z"),
  message(
    "msg-g04",
    katherine,
    "Unread badges are off by one on Random if you mute then unmute. I counted 12 in the sidebar and 11 in the list.",
    "2026-08-31T13:22:00.000Z",
    { reactions: [{ emoji: "👀", authors: [ada.id, demo.id] }] },
  ),
  message(
    "msg-g05",
    demo,
    "+1 on unread — the 12 on Random is a bit shouty.",
    "2026-08-31T13:24:00.000Z",
  ),
  message(
    "msg-g06",
    margaret,
    "Unrelated: guest lobby copy still says “waiting room”. We renamed that last week.",
    "2026-08-31T13:41:00.000Z",
  ),
  message(
    "msg-g07",
    ada,
    "@Margaret Hamilton can you land the lobby string with the rest of the guest pane?",
    "2026-08-31T13:43:00.000Z",
    { mentions: [mentionOf(margaret)] },
  ),
  message("msg-g08", margaret, "On it.", "2026-08-31T13:44:00.000Z"),
  message(
    "msg-g09",
    alan,
    "Poll cadence felt snappy in the call, but once everyone is connected we should idle closer to 4s. Otherwise the tab keeps waking up for nothing.",
    "2026-08-31T14:10:00.000Z",
  ),
  message("msg-g10", demo, "Logged.", "2026-08-31T14:12:00.000Z"),
  message(
    "msg-g11",
    katherine,
    "@Ada Lovelace the member count on General should be 6 once Alan, Margaret and I are in the directory.",
    "2026-08-31T14:36:00.000Z",
    { mentions: [mentionOf(ada)] },
  ),
  message("msg-g12", ada, "Yes — leave it at 6.", "2026-08-31T14:37:00.000Z"),
  message(
    "msg-g13",
    grace,
    "Quick check: date pills should say Yesterday / Today, not the raw ISO.",
    "2026-08-31T15:02:00.000Z",
  ),
  message(
    "msg-g14",
    grace,
    "I’ll screenshot after I dump a longer history in.",
    "2026-08-31T15:04:00.000Z",
  ),
  message(
    "msg-g15",
    margaret,
    "Thread drawer during a call is still the part I’m least sure about. Idle panel is fine; once the stage takes the right rail the replies need to overlay the chat column without covering the composer.",
    "2026-08-31T15:31:00.000Z",
  ),
  message("msg-g16", alan, "I can pair on that after standup.", "2026-08-31T15:33:00.000Z"),
  message(
    "msg-g17",
    demo,
    "@Grace Hopper parking a note: keep scroll stuck to the latest message so a busy channel still lands at the bottom.",
    "2026-08-31T16:05:00.000Z",
    { mentions: [mentionOf(grace)] },
  ),
  message(
    "msg-g18",
    katherine,
    "Agreed — history above, newest at the fold.",
    "2026-08-31T16:07:00.000Z",
  ),
  message(
    "msg-0",
    grace,
    "Parking yesterday's recap here so we can start fresh tomorrow.",
    "2026-08-31T16:40:00.000Z",
  ),
  message("msg-g19", ada, "Night — pick this up at 9.", "2026-08-31T16:42:00.000Z"),
  message("msg-g20", katherine, "Night.", "2026-08-31T16:43:00.000Z"),

  message(
    "msg-g21",
    margaret,
    "Morning. Lobby copy is updated locally.",
    "2026-09-01T07:32:00.000Z",
  ),
  message("msg-g22", ada, "Nice.", "2026-09-01T07:34:00.000Z"),
  message(
    "msg-g23",
    demo,
    "Review queue for today: composer a11y, thread open on #general, then the call-drawer overlap Margaret flagged.",
    "2026-09-01T07:51:00.000Z",
  ),
  message(
    "msg-g24",
    alan,
    "@Demo User I can take composer a11y if you want the thread story.",
    "2026-09-01T07:53:00.000Z",
    { mentions: [mentionOf(demo)] },
  ),
  message("msg-g25", demo, "Deal.", "2026-09-01T07:54:00.000Z"),
  message(
    "msg-1",
    ada,
    "Morning @Demo User — notes are in https://docs.example.com/notes/sprint",
    "2026-09-01T09:00:00.000Z",
    {
      reactions: [
        { emoji: "👍", authors: [demo.id] },
        { emoji: "🔥", authors: [grace.id, demo.id] },
      ],
      mentions: [mentionOf(demo)],
      replyCount: 2,
    },
  ),
  message("msg-1a", grace, "I'll add the agenda before noon.", "2026-09-01T09:05:00.000Z", {
    parentId: "msg-1",
  }),
  message(
    "msg-1b",
    demo,
    "Thanks — I will review @Ada Lovelace's notes.",
    "2026-09-01T09:08:00.000Z",
    { parentId: "msg-1", mentions: [mentionOf(ada)] },
  ),
  message(
    "msg-g26",
    katherine,
    "Agenda looks tight — can we drop the ICE debug item?",
    "2026-09-01T09:18:00.000Z",
  ),
  message("msg-g27", grace, "Keep ICE, drop the font audit.", "2026-09-01T09:19:00.000Z"),
  message("msg-g28", demo, "Ack.", "2026-09-01T09:20:00.000Z"),
  message(
    "msg-g29",
    margaret,
    "For the thread drawer: 360px is fine idle. During a call I would rather clip the chat column than cover the composer. People still type while the thread is open.",
    "2026-09-01T09:44:00.000Z",
    { reactions: [{ emoji: "👍", authors: [ada.id, alan.id] }] },
  ),
  message("msg-g30", alan, "I can pair on the drawer after lunch.", "2026-09-01T09:46:00.000Z"),
  message(
    "msg-g31",
    ada,
    "@Alan Turing use the SideDrawer placement story — idle stays a panel.",
    "2026-09-01T09:47:00.000Z",
    { mentions: [mentionOf(alan)] },
  ),
  message("msg-g32", katherine, "Got it.", "2026-09-01T09:48:00.000Z"),
  message(
    "msg-g33",
    demo,
    "Also dumping a longer fixture so Default isn’t three lines.",
    "2026-09-01T10:05:00.000Z",
  ),
  message(
    "msg-g34",
    demo,
    "Yesterday + today, mixed authors, a couple of threads.",
    "2026-09-01T10:06:00.000Z",
  ),
  message(
    "msg-g35",
    grace,
    "Worth a look while we’re here: https://example.com/blog",
    "2026-09-01T10:22:00.000Z",
  ),
  message("msg-g36", margaret, "Card looks fine.", "2026-09-01T10:24:00.000Z"),
  message(
    "msg-g37",
    alan,
    "One more thing from the call: do not rewrite local SDP. Sanitize inbound remote only. I still see a comment in the old notes that implies we mangle both.",
    "2026-09-01T10:51:00.000Z",
  ),
  message(
    "msg-g38",
    ada,
    "Strike that comment. I’ll edit the sprint doc.",
    "2026-09-01T10:53:00.000Z",
  ),
  message(
    "msg-g39",
    katherine,
    "@Grace Hopper can you sanity-check the thread drawer width on a 1280 screen?",
    "2026-09-01T11:16:00.000Z",
    {
      mentions: [mentionOf(grace)],
      replyCount: 2,
    },
  ),
  message(
    "msg-g39a",
    grace,
    "On 1280 the panel is tight but the composer still clears it.",
    "2026-09-01T11:18:00.000Z",
    {
      parentId: "msg-g39",
    },
  ),
  message(
    "msg-g39b",
    demo,
    "Same here — I’ll leave the long history on #general.",
    "2026-09-01T11:20:00.000Z",
    {
      parentId: "msg-g39",
    },
  ),
  message(
    "msg-g40",
    grace,
    "Composer still sits at the bottom with this much history. Good.",
    "2026-09-01T11:41:00.000Z",
  ),
  message(
    "msg-g41",
    margaret,
    "Shipping note: guest stripped channel should stay without a sidebar toggle. Don’t let the dense General fixture leak into that story.",
    "2026-09-01T12:08:00.000Z",
  ),
  message("msg-g42", alan, "It won’t — guest boots its own pane.", "2026-09-01T12:10:00.000Z"),
  message("msg-g43", katherine, "Lunch. Back for the roll-up.", "2026-09-01T12:14:00.000Z"),
  message("msg-g44", demo, "Grabbing lunch too.", "2026-09-01T12:15:00.000Z"),
  message(
    "msg-g45",
    ada,
    "Back. If anyone is still scrolling #general: latest should be down here, with Yesterday above the fold.",
    "2026-09-01T13:02:00.000Z",
    { reactions: [{ emoji: "✅", authors: [demo.id, katherine.id] }] },
  ),
  message("msg-g46", katherine, "Confirmed.", "2026-09-01T13:04:00.000Z"),
  message("msg-g47", margaret, "Same.", "2026-09-01T13:05:00.000Z"),
  message(
    "msg-g48",
    alan,
    "I’ll keep the ICE item on the agenda and drop fonts. See you in the thread.",
    "2026-09-01T13:21:00.000Z",
  ),
  message("msg-g49", grace, "Heading over.", "2026-09-01T13:22:00.000Z"),
  message(
    "msg-g50",
    demo,
    "Landed on the latest — lots of history above. Feels like a real channel.",
    "2026-09-01T13:24:00.000Z",
  ),

  message(
    "msg-2",
    grace,
    "Shared the brief for @Demo User: https://drive.example.com/files/brief",
    "2026-09-01T10:15:00.000Z",
    {
      channelId: "channel-design",
      reactions: [{ emoji: "🔥", authors: [ada.id, demo.id] }],
      mentions: [mentionOf(demo)],
    },
  ),
  message(
    "msg-3",
    ada,
    "Standup in five — guest link is ready. Worth a look: https://example.com/blog",
    "2026-09-01T11:00:00.000Z",
    { channelId: "meeting-standup" },
  ),
  message(
    "msg-4",
    grace,
    "Anyone got a good coffee rec near the studio?",
    "2026-09-01T08:20:00.000Z",
    {
      channelId: "channel-random",
      reactions: [{ emoji: "👍", authors: [ada.id] }],
    },
  ),
  message(
    "msg-5",
    ada,
    "Cut is green — tagging @Demo User for the notes.",
    "2026-09-01T07:45:00.000Z",
    { channelId: "channel-shipping", mentions: [mentionOf(demo)] },
  ),

  message(
    "msg-dm-ada-1",
    ada,
    "Quick ping — the composer keyboard path is ready for a pass if you have five minutes.",
    "2026-08-31T16:12:00.000Z",
    { channelId: meetDirectMessageChannelId(ada.id) },
  ),
  message(
    "msg-dm-ada-2",
    demo,
    "Opening it now. I’ll leave notes in the thread if anything sticks.",
    "2026-08-31T16:18:00.000Z",
    { channelId: meetDirectMessageChannelId(ada.id) },
  ),
  message(
    "msg-dm-ada-3",
    ada,
    "Thanks. Also: unread on Random still feels shouty. Happy to pair after standup.",
    "2026-09-01T08:41:00.000Z",
    { channelId: meetDirectMessageChannelId(ada.id) },
  ),
  message(
    "msg-dm-ada-4",
    demo,
    "Logged — I’ll bump it down once the badge tint lands.",
    "2026-09-01T08:44:00.000Z",
    { channelId: meetDirectMessageChannelId(ada.id) },
  ),
  message(
    "msg-dm-ada-5",
    ada,
    "Sounds good. Sprint notes are still in https://docs.example.com/notes/sprint",
    "2026-09-01T09:02:00.000Z",
    { channelId: meetDirectMessageChannelId(ada.id) },
  ),

  message(
    "msg-dm-grace-1",
    grace,
    "Coffee rec near the studio: the cart on 3rd. Don’t tell #random I said that first.",
    "2026-09-01T08:22:00.000Z",
    { channelId: meetDirectMessageChannelId(grace.id) },
  ),
  message("msg-dm-grace-2", demo, "Ha. I’ll pretend I discovered it.", "2026-09-01T08:25:00.000Z", {
    channelId: meetDirectMessageChannelId(grace.id),
  }),
  message(
    "msg-dm-grace-3",
    grace,
    "Thread drawer width on 1280 is tight but the composer still clears it. Leaving it.",
    "2026-09-01T11:21:00.000Z",
    { channelId: meetDirectMessageChannelId(grace.id) },
  ),

  message(
    "msg-dm-alan-1",
    alan,
    "Reminder: sanitize inbound remote SDP only. I struck the old note that implied we rewrite both.",
    "2026-09-01T10:54:00.000Z",
    { channelId: meetDirectMessageChannelId(alan.id) },
  ),
  message("msg-dm-alan-2", demo, "Ack — thanks for the catch.", "2026-09-01T10:56:00.000Z", {
    channelId: meetDirectMessageChannelId(alan.id),
  }),
  message(
    "msg-dm-alan-3",
    alan,
    "I can still pair on the call-drawer overlap after lunch.",
    "2026-09-01T11:02:00.000Z",
    { channelId: meetDirectMessageChannelId(alan.id) },
  ),

  message(
    "msg-dm-katherine-1",
    katherine,
    "Member count on General should stay at 6. I counted Alan, Margaret and me in the directory.",
    "2026-08-31T14:38:00.000Z",
    { channelId: meetDirectMessageChannelId(katherine.id) },
  ),
  message("msg-dm-katherine-2", demo, "Left it at 6.", "2026-08-31T14:40:00.000Z", {
    channelId: meetDirectMessageChannelId(katherine.id),
  }),
  message(
    "msg-dm-katherine-3",
    katherine,
    "One unread left on my side — the Random mute/unmute off-by-one. Flagging so it doesn’t get lost in #general.",
    "2026-09-01T13:06:00.000Z",
    { channelId: meetDirectMessageChannelId(katherine.id) },
  ),

  message(
    "msg-dm-margaret-1",
    margaret,
    "Guest stripped channel stays without a sidebar toggle. Don’t let the dense General fixture leak there.",
    "2026-09-01T12:09:00.000Z",
    { channelId: meetDirectMessageChannelId(margaret.id) },
  ),
  message(
    "msg-dm-margaret-2",
    demo,
    "Guest boots its own pane — we’re good.",
    "2026-09-01T12:11:00.000Z",
    {
      channelId: meetDirectMessageChannelId(margaret.id),
    },
  ),
  message(
    "msg-dm-margaret-3",
    margaret,
    "Lobby copy no longer says waiting room. Landing it with the rest of the guest pane.",
    "2026-09-01T12:16:00.000Z",
    { channelId: meetDirectMessageChannelId(margaret.id) },
  ),
];
