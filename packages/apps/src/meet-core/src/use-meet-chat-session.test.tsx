/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, MeetChatOperations } from "@/meet-core/src/meet-types";
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
    expect(sendMessage).toHaveBeenCalledWith("chat-general", "hello", { messageId: CLIENT_ULID });
    expect((await send.saved)?.id).toBe(CLIENT_ULID);
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
