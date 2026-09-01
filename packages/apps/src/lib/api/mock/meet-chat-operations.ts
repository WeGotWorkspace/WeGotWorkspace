import { mapChatPreviews } from "@/meet-core/src/meet-chat-urls";
import { applyMeetChannelPatch, buildMeetChannel } from "@/meet-core/src/meet-channel-write";
import type {
  ChatMessage,
  MeetChannel,
  MeetChannelWriteInput,
  MeetChatOperations,
  MeetChatState,
  MeetUnfurlMap,
} from "@/meet-core/src/meet-types";
import {
  filterSharePrincipals,
  mergeShareWith,
  type CollectionSharePrincipal,
  type CollectionShareWith,
} from "@/share-ui/collection-share";

export type MeetChatOperationsHandle = MeetChatOperations & {
  getState: () => MeetChatState;
};

function cloneState(state: MeetChatState): MeetChatState {
  return structuredClone(state);
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
}

export function createMeetChatOperations(seed: {
  channels: MeetChannel[];
  messages: ChatMessage[];
  unfurl?: MeetUnfurlMap;
  directory?: CollectionSharePrincipal[];
  author: { id: string; displayName: string };
}): MeetChatOperationsHandle {
  let state: MeetChatState = cloneState({
    channels: seed.channels,
    messages: seed.messages,
  });
  const unfurl = seed.unfurl ?? {};
  const directory = seed.directory ?? [];

  const replaceChannel = (channel: MeetChannel) => {
    state = {
      ...state,
      channels: state.channels.map((row) => (row.id === channel.id ? channel : row)),
    };
    return channel;
  };

  const upsertMessage = (message: ChatMessage) => {
    const existing = state.messages.some((row) => row.id === message.id);
    state = {
      ...state,
      messages: existing
        ? state.messages.map((row) => (row.id === message.id ? message : row))
        : [...state.messages, message],
    };
    return message;
  };

  const buildMessage = (
    channelId: string,
    body: string,
    opts?: { parentId?: string | null },
  ): ChatMessage => {
    const parentId = opts?.parentId ?? null;
    const parent = parentId ? state.messages.find((row) => row.id === parentId) : undefined;
    if (parent) {
      upsertMessage({ ...parent, replyCount: (parent.replyCount ?? 0) + 1 });
    }
    return {
      id: nextId("msg"),
      channelId,
      authorId: seed.author.id,
      authorName: seed.author.displayName,
      body: body.trim(),
      createdAt: Date.now(),
      reactions: [],
      mentions: [],
      previews: mapChatPreviews(body, unfurl),
      parentId,
      threadId: parent?.threadId ?? parent?.id ?? null,
      replyCount: 0,
    };
  };

  return {
    getState: () => cloneState(state),
    sendMessage: async (channelId, body, opts) =>
      upsertMessage(buildMessage(channelId, body, opts)),
    editMessage: async (messageId, body) => {
      const current = state.messages.find((row) => row.id === messageId);
      if (!current) throw new Error(`Unknown message ${messageId}`);
      return upsertMessage({
        ...current,
        body: body.trim(),
        editedAt: Date.now(),
        previews: mapChatPreviews(body, unfurl),
      });
    },
    deleteMessage: async (messageId) => {
      const current = state.messages.find((row) => row.id === messageId);
      if (!current) return;
      upsertMessage({ ...current, deletedAt: Date.now(), body: "", previews: [] });
    },
    react: async (messageId, emoji) => {
      const current = state.messages.find((row) => row.id === messageId);
      if (!current) throw new Error(`Unknown message ${messageId}`);
      const author = seed.author.id;
      const reactions = current.reactions.map((row) => ({ ...row, authors: [...row.authors] }));
      const existing = reactions.find((row) => row.emoji === emoji);
      if (!existing) {
        reactions.push({ emoji, authors: [author] });
      } else if (existing.authors.includes(author)) {
        existing.authors = existing.authors.filter((id) => id !== author);
      } else {
        existing.authors.push(author);
      }
      return upsertMessage({
        ...current,
        reactions: reactions.filter((row) => row.authors.length > 0),
      });
    },
    reply: async (parentId, body) => {
      const parent = state.messages.find((row) => row.id === parentId);
      if (!parent) throw new Error(`Unknown message ${parentId}`);
      return upsertMessage(buildMessage(parent.channelId, body, { parentId }));
    },
    createChannel: async (input: MeetChannelWriteInput) => {
      const channel = buildMeetChannel(input);
      state = { ...state, channels: [...state.channels, channel] };
      return channel;
    },
    patchChannel: async (channelId, patch) => {
      const current = state.channels.find((row) => row.id === channelId);
      if (!current) throw new Error(`Unknown channel ${channelId}`);
      return replaceChannel(applyMeetChannelPatch(current, patch));
    },
    patchChannelShareWith: async (channelId, shareWith: CollectionShareWith) => {
      const current = state.channels.find((row) => row.id === channelId);
      if (!current) throw new Error(`Unknown channel ${channelId}`);
      return replaceChannel({
        ...current,
        shareWith: mergeShareWith(current.shareWith, shareWith),
      });
    },
    startCall: async () => undefined,
    leaveCall: async () => undefined,
    searchSharePrincipals: async (query) => filterSharePrincipals(query, directory),
  };
}
