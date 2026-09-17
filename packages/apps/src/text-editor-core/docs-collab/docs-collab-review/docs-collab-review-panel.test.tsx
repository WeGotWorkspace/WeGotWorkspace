import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { TooltipProvider } from "@/ui/tooltip";
import type { DocsCommentThread } from "../docs-comments-types";
import type { DocsSuggestionWithThread } from "../docs-suggestions-types";
import { DocsCollabReviewPanel } from "./docs-collab-review-panel";

import "./docs-collab-review-panel.css";

const openThread: DocsCommentThread = {
  id: "thread-open",
  anchorText: "hello",
  anchorFrom: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex" },
  resolved: false,
  messages: [
    {
      id: "thread-open-m",
      body: "Open comment",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
};

const resolvedThread: DocsCommentThread = {
  ...openThread,
  id: "thread-resolved",
  resolved: true,
  messages: [
    {
      id: "thread-resolved-m",
      body: "Resolved comment",
      createdAt: "2026-01-01T00:02:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
};

const suggestion: DocsSuggestionWithThread = {
  changeId: "change-1",
  authorName: "Alex",
  authorColor: "#336699",
  timestamp: "2026-01-01T00:00:00.000Z",
  from: 2,
  to: 4,
  anchorText: "world",
  summary: "Replace world",
  parts: [],
  messages: [],
};

const noop = () => {};

function renderPanel(overrides: Partial<ComponentProps<typeof DocsCollabReviewPanel>> = {}) {
  render(
    <TooltipProvider>
      <DocsCollabReviewPanel
        editor={null}
        onCloseMobile={noop}
        labels={docsLabels}
        threads={[openThread, resolvedThread]}
        suggestions={[suggestion]}
        currentUserId="u-1"
        activeThreadId={null}
        activeChangeId={null}
        onSelectThread={noop}
        onAddReply={noop}
        onToggleReaction={noop}
        onResolveThread={noop}
        onSelectSuggestion={noop}
        onAcceptSuggestion={noop}
        onRejectSuggestion={noop}
        onAddSuggestionReply={noop}
        onToggleSuggestionReaction={noop}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("DocsCollabReviewPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
  });

  it("reuses the shared sidebar filter chrome with Open / Resolved segments", () => {
    renderPanel();

    const filter = screen.getByRole("group", { name: docsLabels.reviewFilterAria });
    expect(filter.closest(".docs-collab-sidebar-panel__header-actions")).toBeTruthy();
    expect(document.querySelector(".docs-collab-sidebar-panel__toolbar")).toBeNull();
    expect(filter.className).toContain("docs-collab-sidebar-panel__filter");
    expect(filter.className).toContain("docs-collab-review-panel__filter");
    expect(screen.getByRole("button", { name: docsLabels.reviewTabOpen })).toBeTruthy();
    expect(screen.getByRole("button", { name: docsLabels.reviewTabResolved })).toBeTruthy();
    expect(screen.getByText("Open comment")).toBeTruthy();
    expect(screen.queryByText("Resolved comment")).toBeNull();
  });

  it("switches to resolved comments and hides mutate actions", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: docsLabels.reviewTabResolved }));

    expect(screen.getByText("Resolved comment")).toBeTruthy();
    expect(screen.queryByText("Open comment")).toBeNull();
    expect(screen.queryByLabelText(docsLabels.commentsResolve)).toBeNull();
    expect(screen.queryByText("Replace world")).toBeNull();
  });

  it("shows the resolved empty state", () => {
    renderPanel({ threads: [openThread], suggestions: [] });

    fireEvent.click(screen.getByRole("button", { name: docsLabels.reviewTabResolved }));
    expect(screen.getByText(docsLabels.reviewEmptyResolved)).toBeTruthy();
  });
});
