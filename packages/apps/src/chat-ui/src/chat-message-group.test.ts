import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/chat-ui/src/chat-types";
import {
  CHAT_MESSAGE_GROUP_WINDOW_MS,
  chatMessageDayKey,
  formatChatDayLabel,
  formatChatDayLabelParts,
  formatChatTime,
  groupChatMessages,
  groupChatMessagesByDay,
} from "@/chat-ui/src/chat-message-group";

function message(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "authorId" | "createdAt">,
): ChatMessage {
  return {
    authorName: partial.authorId,
    body: "hi",
    reactions: [],
    mentions: [],
    previews: [],
    ...partial,
  };
}

describe("groupChatMessages", () => {
  it("groups consecutive same-author messages inside the window", () => {
    const start = Date.parse("2026-09-01T09:00:00.000Z");
    const groups = groupChatMessages([
      message({ id: "a1", authorId: "ada", createdAt: start }),
      message({ id: "a2", authorId: "ada", createdAt: start + 60_000 }),
      message({ id: "g1", authorId: "grace", createdAt: start + 90_000 }),
      message({
        id: "a3",
        authorId: "ada",
        createdAt: start + CHAT_MESSAGE_GROUP_WINDOW_MS + 90_001,
      }),
    ]);

    expect(groups.map((group) => group.messages.map((row) => row.id))).toEqual([
      ["a1", "a2"],
      ["g1"],
      ["a3"],
    ]);
  });
});

describe("formatChatTime", () => {
  it("formats a locale time string", () => {
    expect(formatChatTime(Date.parse("2026-09-01T09:00:00.000Z"))).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("groupChatMessagesByDay", () => {
  it("keeps author groups and folds them into calendar-day sections", () => {
    const yesterday = new Date(2026, 7, 31, 18, 0, 0).getTime();
    const todayMorning = new Date(2026, 8, 1, 10, 0, 0).getTime();
    const todayAfternoon = new Date(2026, 8, 1, 15, 0, 0).getTime();
    const now = new Date(2026, 8, 1, 16, 0, 0).getTime();
    const groups = groupChatMessages([
      message({ id: "y1", authorId: "ada", createdAt: yesterday }),
      message({ id: "t1", authorId: "ada", createdAt: todayMorning }),
      message({ id: "t2", authorId: "grace", createdAt: todayAfternoon }),
    ]);
    const days = groupChatMessagesByDay(groups, now);

    expect(days.map((day) => [day.key, day.emphasis, day.groups.map((group) => group.id)])).toEqual(
      [
        ["2026-08-31", "Yesterday", ["y1"]],
        ["2026-09-01", "Today", ["t1", "t2"]],
      ],
    );
    expect(days[0]?.rest).toBe(
      new Date(yesterday).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    expect(days[1]?.rest).toBe(
      new Date(todayMorning).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    expect(days.map((day) => day.label)).toEqual([
      `Yesterday ${days[0]!.rest}`,
      `Today ${days[1]!.rest}`,
    ]);
  });
});

describe("formatChatDayLabel", () => {
  const now = new Date(2026, 8, 1, 15, 0, 0).getTime();

  it("labels today and yesterday with a regular date rest", () => {
    const today = new Date(2026, 8, 1, 10, 14, 0).getTime();
    const yesterday = new Date(2026, 7, 31, 18, 0, 0).getTime();
    expect(formatChatDayLabelParts(today, now)).toEqual({
      emphasis: "Today",
      rest: new Date(today).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    });
    expect(formatChatDayLabelParts(yesterday, now)).toEqual({
      emphasis: "Yesterday",
      rest: new Date(yesterday).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    });
    expect(formatChatDayLabel(today, now)).toBe(
      `Today ${formatChatDayLabelParts(today, now).rest}`,
    );
  });

  it("uses weekday + dated rest for older days", () => {
    const older = new Date(2026, 7, 26, 9, 0, 0).getTime();
    const parts = formatChatDayLabelParts(older, now);
    expect(parts.emphasis).toBe(new Date(older).toLocaleDateString(undefined, { weekday: "long" }));
    expect(parts.rest).toBe(
      new Date(older).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
  });

  it("uses a calendar key that changes with the local day", () => {
    expect(chatMessageDayKey(new Date(2026, 8, 1, 23, 0, 0).getTime())).toBe("2026-09-01");
    expect(chatMessageDayKey(new Date(2026, 7, 31, 1, 0, 0).getTime())).toBe("2026-08-31");
  });
});
