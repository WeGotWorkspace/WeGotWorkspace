import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "@/chat-ui/src/chat-message-list";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import type { ChatMessage } from "@/lib/models/chat-types";
import { TooltipProvider } from "@/ui/tooltip";

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

describe("ChatMessageList empty state", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows a collection-state icon above the empty label", () => {
    render(<ChatMessageList messages={[]} currentUserId={CURRENT_USER} />);
    const label = screen.getByText(chatUiLabels.empty);
    const state = label.closest(".collection-state");
    expect(label.closest(".collection-state__body")).toBeTruthy();
    expect(state?.querySelector(".lucide-message-square")).toBeTruthy();
  });
});

describe("ChatMessageList sticky day labels", () => {
  beforeEach(() => {
    cleanup();
  });

  it("splits sticky day labels into shared emphasis and rest", () => {
    render(<ChatMessageList messages={[msg("1")]} currentUserId={CURRENT_USER} />);
    expect(document.querySelector(".list-sticky-header__emphasis")?.textContent).toBe("Today");
    expect(document.querySelector(".list-sticky-header__rest")?.textContent).toMatch(/\d/);
    expect(document.querySelector(".list-sticky-header")?.getAttribute("aria-label")).toMatch(
      /Today/,
    );
  });
});

describe("ChatMessageList actions and announcements", () => {
  beforeEach(() => {
    cleanup();
  });

  it("runs the latest action handler for a row whose message did not change", () => {
    const messages = [msg("1", CURRENT_USER)];
    const first = vi.fn();
    const second = vi.fn();
    const actions = (onClick: () => void) => () => [{ id: "delete" as const, onClick }];
    const { rerender } = render(
      <TooltipProvider>
        <ChatMessageList
          messages={messages}
          currentUserId={CURRENT_USER}
          actionsForMessage={actions(first)}
        />
      </TooltipProvider>,
    );
    rerender(
      <TooltipProvider>
        <ChatMessageList
          messages={messages}
          currentUserId={CURRENT_USER}
          actionsForMessage={actions(second)}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("announces nothing when the previous last message left the list", () => {
    const { rerender } = render(
      <ChatMessageList messages={[msg("1"), msg("2")]} currentUserId={CURRENT_USER} />,
    );
    rerender(<ChatMessageList messages={[msg("1"), msg("3")]} currentUserId={CURRENT_USER} />);
    const announcer = document.querySelector(".chat-message-list__announcer")!;
    expect(announcer.textContent).toBe("");
  });

  it("announces every message of a commit that appends more than five", () => {
    const first = [msg("1")];
    const { rerender } = render(<ChatMessageList messages={first} currentUserId={CURRENT_USER} />);
    const added = ["2", "3", "4", "5", "6", "7"].map((id) => msg(id));
    rerender(<ChatMessageList messages={[...first, ...added]} currentUserId={CURRENT_USER} />);
    const announcer = document.querySelector(".chat-message-list__announcer")!;
    for (const m of added) expect(announcer.textContent).toContain(`body ${m.id}`);
  });
});
