import { describe, expect, it } from "vitest";
import { parseDocsSuggestionThread } from "./docs-suggestions-schema";

const validThread = {
  messages: [
    {
      id: "m-1",
      body: "Can we clarify?",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
};

describe("parseDocsSuggestionThread", () => {
  it("returns a thread with the map key as changeId", () => {
    expect(parseDocsSuggestionThread(validThread, "change-1")).toEqual({
      changeId: "change-1",
      ...validThread,
    });
  });

  it("accepts optional reactions", () => {
    const parsed = parseDocsSuggestionThread(
      {
        ...validThread,
        reactions: [{ emoji: "👍", userIds: ["u-1"] }],
      },
      "change-2",
    );

    expect(parsed).toMatchObject({
      changeId: "change-2",
      reactions: [{ emoji: "👍", userIds: ["u-1"] }],
    });
  });

  it("drops invalid messages instead of rejecting the thread", () => {
    const parsed = parseDocsSuggestionThread(
      {
        messages: [validThread.messages[0], { body: "missing fields" }, null],
      },
      "change-3",
    );

    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.body).toBe("Can we clarify?");
  });

  it("drops invalid reactions and omits empty reaction lists", () => {
    expect(
      parseDocsSuggestionThread(
        {
          ...validThread,
          reactions: [
            { emoji: "👍", userIds: [] },
            { emoji: "👍", userIds: ["u-1"] },
          ],
        },
        "change-4",
      )?.reactions,
    ).toEqual([{ emoji: "👍", userIds: ["u-1"] }]);

    expect(
      parseDocsSuggestionThread({ ...validThread, reactions: [] }, "change-5")?.reactions,
    ).toBeUndefined();
  });

  it("coerces null author names when parsing stored replies", () => {
    const parsed = parseDocsSuggestionThread(
      {
        messages: [
          {
            id: "m-1",
            body: "Follow-up",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: null },
          },
        ],
      },
      "change-null-author",
    );

    expect(parsed?.messages[0]?.author.name).toBe("Unknown");
  });

  it("returns null for invalid stored payloads", () => {
    expect(parseDocsSuggestionThread(null, "change-6")).toBeNull();
    expect(parseDocsSuggestionThread({ messages: "nope" }, "change-7")).toBeNull();
  });

  it("ignores non-array reactions", () => {
    expect(
      parseDocsSuggestionThread({ ...validThread, reactions: "nope" }, "change-8")?.reactions,
    ).toBeUndefined();
  });
});
