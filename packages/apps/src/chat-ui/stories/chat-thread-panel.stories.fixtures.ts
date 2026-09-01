import type { ChatMentionPrincipal, ChatMessage } from "@/chat-ui/src/chat-types";

export const THREAD_CURRENT_USER_ID = "demo.user";

export const THREAD_PRINCIPALS: ChatMentionPrincipal[] = [
  { id: "ada.lovelace", displayName: "Ada Lovelace" },
  { id: "grace.hopper", displayName: "Grace Hopper" },
  { id: "demo.user", displayName: "Demo User" },
];

export const THREAD_PARENT: ChatMessage = {
  id: "msg-thread-parent",
  channelId: "channel-general",
  authorId: "ada.lovelace",
  authorName: "Ada Lovelace",
  body: "Can someone review the sprint notes before standup?",
  createdAt: Date.parse("2026-09-01T09:00:00.000Z"),
  reactions: [{ emoji: "👍", authors: ["demo.user"] }],
  mentions: [],
  previews: [],
  replyCount: 2,
};

export const THREAD_REPLIES: ChatMessage[] = [
  {
    id: "msg-thread-reply-1",
    channelId: "channel-general",
    authorId: "grace.hopper",
    authorName: "Grace Hopper",
    body: "I left comments on the first two sections.",
    createdAt: Date.parse("2026-09-01T09:04:00.000Z"),
    reactions: [],
    mentions: [],
    previews: [],
    parentId: THREAD_PARENT.id,
    threadId: THREAD_PARENT.id,
  },
  {
    id: "msg-thread-reply-2",
    channelId: "channel-general",
    authorId: "demo.user",
    authorName: "Demo User",
    body: "Thanks — I will land the edits before 10.",
    createdAt: Date.parse("2026-09-01T09:06:00.000Z"),
    reactions: [{ emoji: "✅", authors: ["ada.lovelace"] }],
    mentions: [],
    previews: [],
    parentId: THREAD_PARENT.id,
    threadId: THREAD_PARENT.id,
  },
];
