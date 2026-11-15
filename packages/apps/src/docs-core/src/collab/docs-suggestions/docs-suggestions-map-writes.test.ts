import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getDocsSuggestionThreadsMap } from "../docs-suggestions-map";
import {
  appendSuggestionReply,
  createCommentMessage,
  deleteSuggestionThread,
  pruneOrphanSuggestionThreads,
  toggleSuggestionThreadReaction,
} from "./docs-suggestions-map-writes";

describe("docs-suggestions-map-writes", () => {
  it("toggles reactions for the current user", () => {
    const ydoc = new Y.Doc();
    getDocsSuggestionThreadsMap(ydoc).set("change-1", {
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    expect(toggleSuggestionThreadReaction(ydoc, "change-1", "u-2", "👍")).toBe(true);
    expect(getDocsSuggestionThreadsMap(ydoc).get("change-1")).toMatchObject({
      reactions: [{ emoji: "👍", userIds: ["u-2"] }],
    });

    expect(toggleSuggestionThreadReaction(ydoc, "change-1", "u-2", "👍")).toBe(true);
    expect(getDocsSuggestionThreadsMap(ydoc).get("change-1")).toMatchObject({
      reactions: undefined,
    });
  });

  it("appends replies to suggestion threads", () => {
    const ydoc = new Y.Doc();
    getDocsSuggestionThreadsMap(ydoc).set("change-1", {
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
    expect(appendSuggestionReply(ydoc, "change-1", message!)).toBe(true);

    const stored = getDocsSuggestionThreadsMap(ydoc).get("change-1") as {
      messages: { body: string }[];
    };
    expect(stored.messages.map((item) => item.body)).toEqual(["First", "Second"]);
  });

  it("creates a thread entry when replying to a suggestion without prior thread data", () => {
    const ydoc = new Y.Doc();
    const message = createCommentMessage("First reply", { id: "u-1", name: "Alex" });
    expect(message).not.toBeNull();
    expect(appendSuggestionReply(ydoc, "change-new", message!)).toBe(true);

    expect(getDocsSuggestionThreadsMap(ydoc).get("change-new")).toMatchObject({
      messages: [{ body: "First reply" }],
    });
  });

  it("deletes thread data on accept/reject lifecycle", () => {
    const ydoc = new Y.Doc();
    getDocsSuggestionThreadsMap(ydoc).set("change-1", { messages: [] });
    deleteSuggestionThread(ydoc, "change-1");
    expect(getDocsSuggestionThreadsMap(ydoc).has("change-1")).toBe(false);
  });

  it("prunes orphan thread keys when changes are no longer pending", () => {
    const ydoc = new Y.Doc();
    getDocsSuggestionThreadsMap(ydoc).set("change-1", { messages: [] });
    getDocsSuggestionThreadsMap(ydoc).set("change-2", { messages: [] });

    pruneOrphanSuggestionThreads(ydoc, new Set(["change-2"]));

    expect(getDocsSuggestionThreadsMap(ydoc).has("change-1")).toBe(false);
    expect(getDocsSuggestionThreadsMap(ydoc).has("change-2")).toBe(true);
  });
});
