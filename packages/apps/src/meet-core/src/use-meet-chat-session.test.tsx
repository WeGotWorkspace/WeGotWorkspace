/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, MeetChatOperations } from "@/lib/models/meet-types";
import { useMeetChatSession } from "@/meet-core/src/use-meet-chat-session";

const CLIENT_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function savedRow(id: string, channelId: string, body: string): ChatMessage {
  return {
    id,
    channelId,
    authorId: "alice",
    authorName: "Alice",
    body,
    createdAt: 10,
    reactions: [],
    mentions: [],
    previews: [],
  };
}

function renderChatSession(
  operations?: MeetChatOperations,
  selectedChannelId: string | null = "chat-general",
) {
  return renderHook(() =>
    useMeetChatSession({
      initialMessages: [],
      operations,
      selectedChannelId,
      author: { id: "alice", displayName: "Alice" },
      directory: [],
    }),
  );
}

describe("useMeetChatSession sendChannel", () => {
  it("mints the client ULID before the save and sends it with the create call", async () => {
    const sendMessage = vi.fn(
      async (channelId: string, body: string, opts?: { messageId?: string }) =>
        savedRow(opts?.messageId ?? "server-made-it-up", channelId, body),
    );
    const { result } = renderChatSession({ newMessageId: () => CLIENT_ULID, sendMessage });

    const send = result.current.sendChannel({ body: "hello", mentions: [] });

    expect(send.echoId).toBe(CLIENT_ULID);
    expect(sendMessage).toHaveBeenCalledWith("chat-general", "hello", {
      messageId: CLIENT_ULID,
      mentions: [],
    });
    expect((await send.saved)?.id).toBe(CLIENT_ULID);
  });

  it("hands the composer's mentions to the create call (#2247)", async () => {
    const mentions = [{ id: "sam", displayName: "Sam de Vries" }];
    const sendMessage = vi.fn(
      async (channelId: string, body: string, opts?: { messageId?: string }) =>
        savedRow(opts?.messageId ?? "m1", channelId, body),
    );
    const { result } = renderChatSession({ newMessageId: () => CLIENT_ULID, sendMessage });

    await result.current.sendChannel({ body: "hi @Sam", mentions }).saved;

    expect(sendMessage).toHaveBeenCalledWith("chat-general", "hi @Sam", {
      messageId: CLIENT_ULID,
      mentions,
    });
  });

  it("offers no echo id when nothing mints a real message id", async () => {
    const { result } = renderChatSession();

    const send = result.current.sendChannel({ body: "hello", mentions: [] });

    expect(send.echoId).toBeNull();
    expect((await send.saved)?.id).toMatch(/^local-/);
  });

  it("sends nothing without a selected channel", async () => {
    const sendMessage = vi.fn();
    const { result } = renderChatSession({ sendMessage }, null);

    const send = result.current.sendChannel({ body: "hello", mentions: [] });

    expect(send.echoId).toBeNull();
    expect(await send.saved).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("useMeetChatSession deleteMessage", () => {
  it("deletes a message that never reached the server at once, without the Undo hold", async () => {
    const deleteMessage = vi.fn(async () => undefined);
    const queued: ChatMessage = {
      ...savedRow("queued-1", "chat-general", "later"),
      syncState: "pending",
      sendQueued: true,
    };
    const initialMessages = [queued];
    const { result } = renderHook(() =>
      useMeetChatSession({
        initialMessages,
        operations: { deleteMessage },
        selectedChannelId: "chat-general",
        author: { id: "alice", displayName: "Alice" },
        directory: [],
      }),
    );

    act(() => result.current.deleteMessage("queued-1"));

    expect(deleteMessage).toHaveBeenCalledWith("queued-1");
    expect(result.current.messages[0]?.deletedAt).toBeTruthy();
  });

  function renderWith(row: ChatMessage, deleteMessage: MeetChatOperations["deleteMessage"]) {
    const initialMessages = [row];
    return renderHook(() =>
      useMeetChatSession({
        initialMessages,
        operations: { deleteMessage },
        selectedChannelId: "chat-general",
        author: { id: "alice", displayName: "Alice" },
        directory: [],
      }),
    );
  }

  it("puts the row back when the immediate delete fails", async () => {
    const deleteMessage = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = renderWith(
      { ...savedRow("queued-2", "chat-general", "later"), syncState: "pending", sendQueued: true },
      deleteMessage,
    );

    await act(async () => result.current.deleteMessage("queued-2"));

    expect(deleteMessage).toHaveBeenCalled();
    expect(result.current.messages[0]?.deletedAt).toBeUndefined();
    expect(result.current.messages[0]?.body).toBe("later");
  });

  it("holds the delete of a saved message that only has a pending edit", () => {
    vi.useFakeTimers();
    try {
      const deleteMessage = vi.fn(async () => undefined);
      const { result } = renderWith(
        { ...savedRow("saved-1", "chat-general", "edited"), syncState: "pending" },
        deleteMessage,
      );

      act(() => result.current.deleteMessage("saved-1"));
      expect(deleteMessage).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(10_500);
      });
      expect(deleteMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
