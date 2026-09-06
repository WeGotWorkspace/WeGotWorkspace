import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "@/chat-ui/src/chat-message-list";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import type { ChatMessage } from "@/chat-ui/src/chat-types";

const CURRENT_USER = "demo.user";

function msg(id: string, authorId = "other"): ChatMessage {
  return {
    id,
    authorId,
    authorName: authorId,
    body: `body ${id}`,
    createdAt: Date.now(),
    reactions: [],
    mentions: [],
    previews: [],
  };
}

function mockScrollerAwayFromBottom(el: HTMLElement): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 200 });
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: 0 });
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("ChatMessageList jump chip", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows New messages after inbound while scrolled up, then clears on click", async () => {
    const onCaughtUpChange = vi.fn();
    const { rerender } = render(
      <ChatMessageList
        messages={[msg("1")]}
        currentUserId={CURRENT_USER}
        onCaughtUpChange={onCaughtUpChange}
      />,
    );
    await flushFrame();

    const scroller = screen.getByRole("log");
    mockScrollerAwayFromBottom(scroller);
    fireEvent.scroll(scroller);
    expect(onCaughtUpChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("button", { name: chatUiLabels.newMessages })).toBeNull();

    rerender(
      <ChatMessageList
        messages={[msg("1"), msg("2")]}
        currentUserId={CURRENT_USER}
        onCaughtUpChange={onCaughtUpChange}
      />,
    );
    const jump = screen.getByRole("button", { name: chatUiLabels.newMessages });
    expect(jump.className).toMatch(/chat-message-list__jump/);

    fireEvent.click(jump);
    expect(screen.queryByRole("button", { name: chatUiLabels.newMessages })).toBeNull();
    expect(onCaughtUpChange).toHaveBeenCalledWith(true);
  });

  it("does not show the jump chip for own sends", async () => {
    const { rerender } = render(
      <ChatMessageList messages={[msg("1")]} currentUserId={CURRENT_USER} />,
    );
    await flushFrame();
    const scroller = screen.getByRole("log");
    mockScrollerAwayFromBottom(scroller);
    fireEvent.scroll(scroller);

    rerender(
      <ChatMessageList
        messages={[msg("1"), msg("2", CURRENT_USER)]}
        currentUserId={CURRENT_USER}
      />,
    );
    expect(screen.queryByRole("button", { name: chatUiLabels.newMessages })).toBeNull();
  });
});
