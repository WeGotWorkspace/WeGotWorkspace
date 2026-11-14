import { describe, expect, it } from "vitest";
import {
  docsFileThreadToArchivedSuggestion,
  docsFileThreadToComment,
  docsFileThreadToSuggestion,
  splitDocsFileThreads,
} from "./docs-threads-assemble";
import type { DocsFileThread } from "./docs-threads-types";

const commentRoot: DocsFileThread = {
  id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAA",
  kind: "comment",
  path: "/users/bob/docs/plan.md",
  changeId: null,
  anchorText: "Plan",
  anchorFrom: 0,
  anchorTo: 4,
  anchorOccurrence: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "bob", name: "Bob" },
  resolved: false,
  archived: false,
  messages: [
    {
      id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAA",
      body: "please clarify",
      createdAt: "2026-01-01T00:00:00.000Z",
      author: { id: "bob", name: "Bob" },
    },
    {
      id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAB",
      body: "working on it",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "alice", name: "Alice" },
    },
  ],
  reactions: [{ emoji: "👍", userIds: ["alice"] }],
};

const suggestionRoot: DocsFileThread = {
  id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAC",
  kind: "suggestion",
  path: "/users/bob/docs/plan.md",
  changeId: "change-1",
  anchorText: "",
  anchorFrom: null,
  anchorTo: null,
  anchorOccurrence: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "bob", name: "Bob" },
  resolved: false,
  archived: false,
  messages: [
    {
      id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAC",
      body: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      author: { id: "bob", name: "Bob" },
    },
    {
      id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAD",
      body: "why this edit?",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "alice", name: "Alice" },
    },
  ],
  reactions: [],
};

const archivedSuggestion: DocsFileThread = {
  ...suggestionRoot,
  id: "01J6Y6M0R2V9GKJ4W1T8Q3ZBAE",
  changeId: "change-gone",
  archived: true,
};

describe("docs-threads-assemble", () => {
  it("assembles RELATED-TO replies onto the comment thread messages list", () => {
    const comment = docsFileThreadToComment(commentRoot);
    expect(comment.messages.map((message) => message.body)).toEqual([
      "please clarify",
      "working on it",
    ]);
    expect(comment.reactions).toEqual([{ emoji: "👍", userIds: ["alice"] }]);
  });

  it("drops empty suggestion root bodies used for reaction-only journals", () => {
    const suggestion = docsFileThreadToSuggestion(suggestionRoot);
    expect(suggestion.changeId).toBe("change-1");
    expect(suggestion.messages.map((message) => message.body)).toEqual(["why this edit?"]);
  });

  it("splits kinds, keeps pending suggestions for Open, and maps archived journals for Resolved", () => {
    const split = splitDocsFileThreads([commentRoot, suggestionRoot, archivedSuggestion]);
    expect(split.comments).toHaveLength(1);
    expect(split.suggestions.map((thread) => thread.changeId)).toEqual(["change-1"]);
    expect(split.archivedSuggestions.map((thread) => thread.changeId)).toEqual(["change-gone"]);
    expect(split.archivedSuggestions[0]?.archived).toBe(true);
    expect(split.archivedSuggestions[0]?.messages.map((message) => message.body)).toEqual([
      "why this edit?",
    ]);
  });

  it("maps archived journals to review cards from stored anchors without a live mark", () => {
    const archived = docsFileThreadToArchivedSuggestion({
      ...archivedSuggestion,
      anchorText: "Insert hello",
      anchorFrom: 12,
      anchorTo: 17,
    });
    expect(archived.archived).toBe(true);
    expect(archived.from).toBe(12);
    expect(archived.to).toBe(17);
    expect(archived.summary).toBe("Insert hello");
    expect(archived.parts).toEqual([]);
    expect(archived.messages.map((message) => message.body)).toEqual(["why this edit?"]);
  });
});
