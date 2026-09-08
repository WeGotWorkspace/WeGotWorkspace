import type {
  ChatAuthorPresenceMap,
  ChatLinkPreview,
  ChatMentionPrincipal,
  ChatMessage,
  ChatUnfurlMap,
} from "@/chat-ui/src/chat-types";
import { mapChatPreviews } from "@/meet-core/src/meet-chat-urls";

export const CHAT_STORY_CURRENT_USER_ID = "demo.user";

export const CHAT_STORY_PRINCIPALS: ChatMentionPrincipal[] = [
  { id: "ada.lovelace", displayName: "Ada Lovelace" },
  { id: "grace.hopper", displayName: "Grace Hopper" },
  { id: "demo.user", displayName: "Demo User" },
];

export const CHAT_STORY_AUTHOR_PRESENCE: ChatAuthorPresenceMap = {
  "ada.lovelace": "online",
  "grace.hopper": "offline",
  "demo.user": "online",
};

export const CHAT_STORY_UNFURL: ChatUnfurlMap = {
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

export const CHAT_STORY_PREVIEW_DOCS = CHAT_STORY_UNFURL["https://docs.example.com/notes/sprint"]!;
export const CHAT_STORY_PREVIEW_FILE = CHAT_STORY_UNFURL["https://drive.example.com/files/brief"]!;
export const CHAT_STORY_PREVIEW_EXTERNAL = CHAT_STORY_UNFURL["https://example.com/blog"]!;

const START = Date.parse("2026-09-01T09:00:00.000Z");

function message(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "authorId" | "authorName" | "body">,
): ChatMessage {
  return {
    createdAt: START,
    reactions: [],
    mentions: [],
    previews: [],
    ...partial,
  };
}

export const CHAT_STORY_MESSAGE_DOCS = message({
  id: "msg-docs",
  authorId: "ada.lovelace",
  authorName: "Ada Lovelace",
  body: "Morning — notes are in https://docs.example.com/notes/sprint",
  createdAt: START,
  reactions: [{ emoji: "👍", authors: [CHAT_STORY_CURRENT_USER_ID] }],
  previews: [CHAT_STORY_PREVIEW_DOCS],
});

export const CHAT_STORY_MESSAGE_FILE = message({
  id: "msg-file",
  authorId: "grace.hopper",
  authorName: "Grace Hopper",
  body: "Shared the brief: https://drive.example.com/files/brief",
  createdAt: START + 75 * 60_000,
  previews: [CHAT_STORY_PREVIEW_FILE],
});

export const CHAT_STORY_MESSAGE_EXTERNAL = message({
  id: "msg-external",
  authorId: "ada.lovelace",
  authorName: "Ada Lovelace",
  body: "Worth a read: https://example.com/blog",
  createdAt: START + 80 * 60_000,
  previews: [CHAT_STORY_PREVIEW_EXTERNAL],
});

export const CHAT_STORY_MESSAGE_MISSING = message({
  id: "msg-missing",
  authorId: "grace.hopper",
  authorName: "Grace Hopper",
  body: "This link has no unfurl: https://unknown.example/x",
  createdAt: START + 85 * 60_000,
  previews: [],
});

export const CHAT_STORY_MESSAGE_EDITED = message({
  id: "msg-edited",
  authorId: "demo.user",
  authorName: "Demo User",
  body: "Updated the **agenda** after standup.",
  createdAt: START + 90 * 60_000,
  editedAt: START + 95 * 60_000,
});

export const CHAT_STORY_MESSAGE_DELETED = message({
  id: "msg-deleted",
  authorId: "ada.lovelace",
  authorName: "Ada Lovelace",
  body: "",
  createdAt: START + 100 * 60_000,
  deletedAt: START + 101 * 60_000,
});

export const CHAT_STORY_MESSAGE_PLAIN = message({
  id: "msg-plain",
  authorId: "ada.lovelace",
  authorName: "Ada Lovelace",
  body: "Hey @Demo User — can you review the notes?",
  createdAt: START + 5 * 60_000,
  mentions: [{ id: "demo.user", displayName: "Demo User" }],
  replyCount: 2,
});

export const CHAT_STORY_MESSAGE_YESTERDAY = message({
  id: "msg-yesterday",
  authorId: "grace.hopper",
  authorName: "Grace Hopper",
  body: "Parking yesterday's recap here so we can start fresh tomorrow.",
  createdAt: START - 18 * 60 * 60_000,
});

export const CHAT_STORY_MESSAGES: ChatMessage[] = [
  CHAT_STORY_MESSAGE_YESTERDAY,
  CHAT_STORY_MESSAGE_DOCS,
  CHAT_STORY_MESSAGE_PLAIN,
  CHAT_STORY_MESSAGE_FILE,
  CHAT_STORY_MESSAGE_EXTERNAL,
  CHAT_STORY_MESSAGE_MISSING,
  CHAT_STORY_MESSAGE_EDITED,
];

export function attachChatStoryPreviews(body: string): ChatLinkPreview[] {
  return mapChatPreviews(body, CHAT_STORY_UNFURL);
}
