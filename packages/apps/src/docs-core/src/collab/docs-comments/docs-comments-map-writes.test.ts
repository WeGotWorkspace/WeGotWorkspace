import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getDocsCommentsMap } from "../docs-comments-map";
import {
  appendCommentReply,
  createCommentMessage,
  toggleCommentThreadReaction,
} from "./docs-comments-map-writes";

describe("docs-comments-map-writes", () => {
  it("normalizes authors with missing display names", () => {
    const message = createCommentMessage("Note", { id: "u-1", name: null as unknown as string });
    expect(message?.author.name).toBe("u-1");
  });

  it("toggles reactions for the current user", () => {
    const ydoc = new Y.Doc();
    getDocsCommentsMap(ydoc).set("t-1", {
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
    });

    expect(toggleCommentThreadReaction(ydoc, "t-1", "u-2", "👍")).toBe(true);
    expect(getDocsCommentsMap(ydoc).get("t-1")).toMatchObject({
      reactions: [{ emoji: "👍", userIds: ["u-2"] }],
    });

    expect(toggleCommentThreadReaction(ydoc, "t-1", "u-2", "👍")).toBe(true);
    expect(getDocsCommentsMap(ydoc).get("t-1")).toMatchObject({ reactions: undefined });
  });

  it("appends replies to open threads", () => {
    const ydoc = new Y.Doc();
    getDocsCommentsMap(ydoc).set("t-1", {
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const message = createCommentMessage("Second", { id: "u-2", name: "Sam" });
    expect(message).not.toBeNull();
    expect(appendCommentReply(ydoc, "t-1", message!)).toBe(true);

    const stored = getDocsCommentsMap(ydoc).get("t-1") as { messages: { body: string }[] };
    expect(stored.messages.map((item) => item.body)).toEqual(["First", "Second"]);
  });
});
