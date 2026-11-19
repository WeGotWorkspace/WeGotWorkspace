// The chat log windows from the newest message (#1641 step d, chunk F): a channel
// of 1,000 messages mounts only the messages near the viewport, and only those
// create a text editor.
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/models/chat-types";
import { installListLayoutStubs } from "@/workspace-list/src/workspace-list-test-layout";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { TooltipProvider } from "@/ui/tooltip";

const renders: string[] = [];

vi.mock("@/chat-ui/src/chat-message", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/chat-ui/src/chat-message")>();
  return {
    ...actual,
    ChatMessage: (props: Parameters<typeof actual.ChatMessage>[0]) => {
      renders.push(props.message.id);
      return createElement(actual.ChatMessage, props);
    },
  };
});

const { ChatMessageList } = await import("@/chat-ui/src/chat-message-list");

const CURRENT_USER = "demo.user";
const VIEWPORT_PX = 600;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `count` messages over the last ten days, oldest first, in runs of four per author. */
function channel(count: number): ChatMessage[] {
  const start = Date.now() - 10 * DAY_MS;
  const step = Math.floor((10 * DAY_MS - 60 * 60 * 1000) / count);
  return Array.from({ length: count }, (_, index) => {
    const author = Math.floor(index / 4) % 2 === 0 ? "alice" : "bob";
    return {
      id: `m-${String(index + 1).padStart(4, "0")}`,
      authorId: author,
      authorName: author,
      body: `Message ${index + 1}`,
      createdAt: start + index * step,
      reactions: [],
      mentions: [],
      previews: [],
    };
  });
}

function scroller(): HTMLElement {
  return screen.getByRole("log");
}

/** The list ignores scroll events until the frame after its own scroll to the newest. */
async function scrollToTop(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  act(() => {
    scroller().scrollTop = 0;
    fireEvent.scroll(scroller());
  });
}

function mountedIds(): string[] {
  return Array.from(document.querySelectorAll(".chat-message-list__row[data-list-item-id]")).map(
    (row) => row.getAttribute("data-list-item-id")!,
  );
}

/**
 * jsdom has no layout or Tailwind: the log scrolls, with a 600 px viewport and
 * 120,000 px of content.
 * Rows report no size, so the window works from the estimates.
 */
beforeEach(() => {
  // Midday, local time: the newest message (an hour ago) is always "Today",
  // even when the suite runs just after midnight.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
  renders.length = 0;
  installListLayoutStubs(VIEWPORT_PX);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("chat-message-list__scroll") ? VIEWPORT_PX : 0;
  });
  const realStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = realStyle(element, pseudo);
    if (!element.classList.contains("chat-message-list__scroll")) return style;
    return new Proxy(style, {
      get: (target, key) => {
        if (key === "overflowY") return "auto";
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  // Tall enough that the top of the log is far from its newest message.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("chat-message-list__scroll") ? 120_000 : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ChatMessageList with 1,000 messages", () => {
  it("mounts only the newest messages, each with its own editor", () => {
    const messages = channel(1000);
    const { container } = render(
      <ChatMessageList messages={messages} currentUserId={CURRENT_USER} />,
    );

    const ids = mountedIds();
    expect(ids.length).toBeGreaterThan(3);
    expect(ids.length).toBeLessThan(80);
    expect(ids).toContain("m-1000");
    expect(ids).not.toContain("m-0001");
    // One read-only editor per mounted message, none for the rest.
    expect(container.querySelectorAll(".chat-message__body")).toHaveLength(ids.length);
    const list = container.querySelector("[data-workspace-list-rows]");
    expect(Number(list?.getAttribute("data-workspace-list-rows"))).toBeGreaterThan(1000);
  });

  it("keeps the newest day's header over its mounted messages", () => {
    render(<ChatMessageList messages={channel(1000)} currentUserId={CURRENT_USER} />);

    const newest = document.querySelector('[data-list-item-id="m-1000"]')!;
    const day = newest.closest('[role="group"]')!;
    expect(day.querySelector(".list-sticky-header__emphasis")?.textContent).toBe("Today");
    expect(day.getAttribute("aria-labelledby")).toBe(day.querySelector(".list-sticky-header")?.id);
  });

  it("mounts the oldest messages when scrolled to the top, and keeps the edited one", async () => {
    render(
      <ChatMessageList
        messages={channel(1000)}
        currentUserId={CURRENT_USER}
        editingMessageId="m-1000"
        editComposer={() => <textarea aria-label="Edit message" />}
      />,
    );

    await scrollToTop();

    const ids = mountedIds();
    expect(ids).toContain("m-0001");
    expect(ids).not.toContain("m-0500");
    // The edit composer is not lost while its message is out of view.
    expect(ids).toContain("m-1000");
    expect(screen.getByRole("textbox", { name: "Edit message" })).toBeTruthy();
    expect(document.querySelector(".list-sticky-header")?.textContent).not.toMatch(/Today/);
  });

  it("renders no existing message again when one arrives", () => {
    const messages = channel(1000);
    const { rerender } = render(
      <ChatMessageList messages={messages} currentUserId={CURRENT_USER} />,
    );
    renders.length = 0;

    // Another author: a new run, so the previous message keeps its padding.
    const arriving: ChatMessage = {
      ...messages.at(-1)!,
      id: "m-new",
      authorId: "carol",
      authorName: "carol",
      body: "Hello there",
    };
    rerender(<ChatMessageList messages={[...messages, arriving]} currentUserId={CURRENT_USER} />);

    expect(renders).toEqual(["m-new"]);
  });

  it("shows New messages when one arrives while scrolled up", async () => {
    const messages = channel(1000);
    const { rerender } = render(
      <ChatMessageList messages={messages} currentUserId={CURRENT_USER} />,
    );
    await scrollToTop();

    const arriving: ChatMessage = { ...messages.at(-1)!, id: "m-new", authorId: "bob" };
    rerender(<ChatMessageList messages={[...messages, arriving]} currentUserId={CURRENT_USER} />);

    expect(screen.getByRole("button", { name: chatUiLabels.newMessages })).toBeTruthy();
    expect(mountedIds()).toContain("m-0001");
  });
});

describe("ChatMessageList hover actions", () => {
  it("runs the latest handler on a row that did not re-render", () => {
    const messages = channel(1000);
    const first = vi.fn();
    const latest = vi.fn();
    const actionsWith = (onDelete: () => void) => () => [
      { id: "delete" as const, onClick: onDelete },
    ];
    const { rerender } = render(
      <ChatMessageList
        messages={messages}
        currentUserId={CURRENT_USER}
        actionsForMessage={actionsWith(first)}
      />,
      { wrapper: TooltipProvider },
    );
    renders.length = 0;

    rerender(
      <ChatMessageList
        messages={messages}
        currentUserId={CURRENT_USER}
        actionsForMessage={actionsWith(latest)}
      />,
    );
    expect(renders).toEqual([]);
    const newest = document.querySelector('[data-list-item-id="m-1000"]') as HTMLElement;
    fireEvent.click(within(newest).getByRole("button", { name: chatUiLabels.delete }));

    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("ChatMessageList screen reader", () => {
  it("announces an arriving message once, and nothing for messages that scroll in", async () => {
    const messages = channel(1000);
    const { rerender } = render(
      <ChatMessageList messages={messages} currentUserId={CURRENT_USER} />,
    );
    // Rows mounting while scrolling are not news: the log itself is not live.
    expect(scroller().getAttribute("aria-live")).toBe("off");
    const announcer = document.querySelector(".chat-message-list__announcer")!;
    expect(announcer.getAttribute("aria-live")).toBe("polite");

    await scrollToTop();
    expect(announcer.textContent).toBe("");

    const arriving: ChatMessage = {
      ...messages.at(-1)!,
      id: "m-new",
      authorName: "bob",
      body: "**Lunch** at noon?",
    };
    rerender(<ChatMessageList messages={[...messages, arriving]} currentUserId={CURRENT_USER} />);
    expect(announcer.textContent).toBe("bob: Lunch at noon?");
  });

  it("announces nothing when the newest message is removed", () => {
    const messages = channel(1000);
    const { rerender } = render(
      <ChatMessageList messages={messages} currentUserId={CURRENT_USER} />,
    );
    rerender(<ChatMessageList messages={messages.slice(0, -1)} currentUserId={CURRENT_USER} />);

    expect(document.querySelector(".chat-message-list__announcer")?.textContent).toBe("");
  });

  it("announces every message of a catch-up, also more than five", () => {
    const messages = channel(1000);
    const { rerender } = render(
      <ChatMessageList messages={messages} currentUserId={CURRENT_USER} />,
    );
    const catchUp = Array.from({ length: 6 }, (_, index) => ({
      ...messages.at(-1)!,
      id: `m-late-${index}`,
      body: `Late ${index + 1}`,
    }));
    rerender(<ChatMessageList messages={[...messages, ...catchUp]} currentUserId={CURRENT_USER} />);

    const read = Array.from(
      document.querySelectorAll(".chat-message-list__announcer p"),
      (line) => line.textContent,
    );
    expect(read).toEqual(catchUp.map((message) => `${message.authorName}: ${message.body}`));
  });
});

describe("ChatMessageList with 80 rows or fewer", () => {
  it("mounts every message with no spacers", () => {
    // 60 messages and their 10 day headers.
    const { container } = render(
      <ChatMessageList messages={channel(60)} currentUserId={CURRENT_USER} />,
    );
    expect(mountedIds()).toHaveLength(60);
    expect(container.querySelector("[data-workspace-list-spacer]")).toBeNull();
  });
});
