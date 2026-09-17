import { describe, expect, it } from "vitest";
import type { DocsCommentThread } from "../docs-comments-types";
import type { DocsSuggestionWithThread } from "../docs-suggestions-types";
import { filterReviewItemsByTab, sortReviewItemsByDocumentOrder } from "./docs-collab-review-utils";

const commentThread = (id: string, anchorFrom: number): DocsCommentThread => ({
  id,
  anchorText: id,
  anchorFrom,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex" },
  resolved: false,
  messages: [
    {
      id: `m-${id}`,
      body: id,
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
});

const suggestion = (changeId: string, from: number): DocsSuggestionWithThread => ({
  changeId,
  authorName: "Alex",
  authorColor: "#336699",
  timestamp: "2026-01-01T00:00:00.000Z",
  from,
  to: from + 1,
  anchorText: changeId,
  summary: `Change ${changeId}`,
  parts: [],
  messages: [],
});

describe("sortReviewItemsByDocumentOrder", () => {
  it("interleaves comments and suggestions by document position", () => {
    const items = sortReviewItemsByDocumentOrder(
      null,
      [commentThread("t-late", 30), commentThread("t-early", 8)],
      [suggestion("s-mid", 18), suggestion("s-end", 40)],
    );

    expect(
      items.map((item) => (item.type === "comment" ? item.thread.id : item.suggestion.changeId)),
    ).toEqual(["t-early", "s-mid", "t-late", "s-end"]);
  });

  it("includes draft threads at their anchor position", () => {
    const items = sortReviewItemsByDocumentOrder(
      null,
      [commentThread("t-open", 20), commentThread("t-draft", 5)],
      [suggestion("s-1", 12)],
    );

    expect(
      items.map((item) => (item.type === "comment" ? item.thread.id : item.suggestion.changeId)),
    ).toEqual(["t-draft", "s-1", "t-open"]);
  });

  it("returns an empty list when there are no review items", () => {
    expect(sortReviewItemsByDocumentOrder(null, [], [])).toEqual([]);
  });
});

describe("filterReviewItemsByTab", () => {
  it("keeps open comments and suggestions on the open tab", () => {
    const resolved = { ...commentThread("t-done", 4), resolved: true };
    const items = filterReviewItemsByTab(
      "open",
      [commentThread("t-open", 10), resolved],
      [suggestion("s-1", 5)],
      null,
    );

    expect(
      items.map((item) => (item.type === "comment" ? item.thread.id : item.suggestion.changeId)),
    ).toEqual(["s-1", "t-open"]);
  });

  it("shows only resolved comments on the resolved tab", () => {
    const resolved = { ...commentThread("t-done", 4), resolved: true };
    const items = filterReviewItemsByTab(
      "resolved",
      [commentThread("t-open", 10), resolved],
      [suggestion("s-1", 5)],
      null,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("comment");
    if (items[0]?.type === "comment") {
      expect(items[0].thread.id).toBe("t-done");
    }
  });
});
