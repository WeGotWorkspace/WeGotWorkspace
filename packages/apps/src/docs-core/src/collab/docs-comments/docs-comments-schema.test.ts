import { describe, expect, it } from "vitest";
import { parseDocsCommentThread } from "./docs-comments-schema";

const validThread = {
  anchorText: "world",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex" },
  resolved: false,
  messages: [
    {
      id: "m-1",
      body: "Note",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
};

describe("parseDocsCommentThread", () => {
  it("returns a thread with the map key as id", () => {
    expect(parseDocsCommentThread(validThread, "t-1")).toEqual({
      id: "t-1",
      ...validThread,
    });
  });

  it("accepts optional anchor positions and reactions", () => {
    const parsed = parseDocsCommentThread(
      {
        ...validThread,
        anchorFrom: 7,
        anchorTo: 12,
        anchorOccurrence: 0,
        reactions: [{ emoji: "👍", userIds: ["u-1"] }],
      },
      "t-2",
    );

    expect(parsed).toMatchObject({
      id: "t-2",
      anchorFrom: 7,
      anchorTo: 12,
      anchorOccurrence: 0,
      reactions: [{ emoji: "👍", userIds: ["u-1"] }],
    });
  });

  it("drops invalid messages instead of rejecting the thread", () => {
    const parsed = parseDocsCommentThread(
      {
        ...validThread,
        messages: [validThread.messages[0], { body: "missing fields" }, null],
      },
      "t-3",
    );

    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]?.body).toBe("Note");
  });

  it("drops invalid reactions and omits empty reaction lists", () => {
    expect(
      parseDocsCommentThread(
        {
          ...validThread,
          reactions: [
            { emoji: "👍", userIds: [] },
            { emoji: "👍", userIds: ["u-1"] },
          ],
        },
        "t-4",
      )?.reactions,
    ).toEqual([{ emoji: "👍", userIds: ["u-1"] }]);

    expect(
      parseDocsCommentThread({ ...validThread, reactions: [] }, "t-5")?.reactions,
    ).toBeUndefined();
  });

  it("returns null for invalid stored payloads", () => {
    expect(parseDocsCommentThread(null, "t-6")).toBeNull();
    expect(parseDocsCommentThread({ ...validThread, anchorText: 1 }, "t-7")).toBeNull();
    expect(parseDocsCommentThread({ ...validThread, resolved: "no" }, "t-8")).toBeNull();
    expect(parseDocsCommentThread({ ...validThread, messages: "nope" }, "t-9")).toBeNull();
  });

  it("ignores non-array reactions", () => {
    expect(
      parseDocsCommentThread({ ...validThread, reactions: "nope" }, "t-10")?.reactions,
    ).toBeUndefined();
  });
});
