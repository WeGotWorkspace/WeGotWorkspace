import { describe, expect, it } from "vitest";
import type { DocsCommentThread } from "../docs-comments-types";
import type { DocsSuggestionWithThread } from "../docs-suggestions-types";
import {
  countOpenReviewItems,
  filterReviewItemsByTab,
  sortReviewItemsByDocumentOrder,
} from "./docs-collab-review-utils";

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

  it("shows only resolved comments on the resolved tab when suggestions are still pending", () => {
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

  it("places archived suggestion threads on the resolved tab", () => {
    const items = filterReviewItemsByTab(
      "resolved",
      [],
      [suggestion("s-open", 1), { ...suggestion("s-archived", 8), archived: true }],
      null,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("suggestion");
    if (items[0]?.type === "suggestion") {
      expect(items[0].suggestion.changeId).toBe("s-archived");
    }
  });

  it("keeps pending suggestions off the resolved tab and off Open once archived", () => {
    const archived = { ...suggestion("s-archived", 1), archived: true };
    expect(
      filterReviewItemsByTab("open", [], [archived], null).map((item) =>
        item.type === "suggestion" ? item.suggestion.changeId : item.thread.id,
      ),
    ).toEqual([]);
    expect(
      filterReviewItemsByTab("resolved", [], [archived], null).map((item) =>
        item.type === "suggestion" ? item.suggestion.changeId : item.thread.id,
      ),
    ).toEqual(["s-archived"]);
  });

  it("counts only open comments and pending suggestions for the header badge", () => {
    const resolved = { ...commentThread("t-done", 4), resolved: true };
    const archived = { ...suggestion("s-archived", 8), archived: true };
    expect(
      countOpenReviewItems(
        [commentThread("t-open", 10), resolved],
        [suggestion("s-1", 5), archived],
      ),
    ).toBe(2);
  });

  it("orders resolved items by last-message recency, newest first", () => {
    const older = {
      ...commentThread("t-old", 40),
      resolved: true,
      messages: [
        {
          id: "m-old",
          body: "old",
          createdAt: "2026-01-01T12:00:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    };
    const newer = {
      ...commentThread("t-new", 4),
      resolved: true,
      messages: [
        {
          id: "m-new",
          body: "new",
          createdAt: "2026-01-03T12:00:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    };
    const archivedMid = {
      ...suggestion("s-mid", 1),
      archived: true,
      messages: [
        {
          id: "m-mid",
          body: "mid",
          createdAt: "2026-01-02T12:00:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    };

    const resolvedIds = filterReviewItemsByTab("resolved", [older, newer], [archivedMid], null).map(
      (item) => (item.type === "comment" ? item.thread.id : item.suggestion.changeId),
    );
    expect(resolvedIds).toEqual(["t-new", "s-mid", "t-old"]);

    const openIds = filterReviewItemsByTab(
      "open",
      [commentThread("t-late", 30), commentThread("t-early", 8)],
      [suggestion("s-mid-open", 18)],
      null,
    ).map((item) => (item.type === "comment" ? item.thread.id : item.suggestion.changeId));
    expect(openIds).toEqual(["t-early", "s-mid-open", "t-late"]);
  });
});
