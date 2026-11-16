import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { TooltipProvider } from "@/ui/tooltip";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";
import { DocsCommentsPanel } from "./docs-comments-panel";

import "./docs-comments-panel.css";

const thread: DocsCommentThread = {
  id: "thread-1",
  anchorText: "hello",
  anchorFrom: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: { id: "u-1", name: "Alex" },
  resolved: false,
  messages: [
    {
      id: "thread-1-m",
      body: "First comment",
      createdAt: "2026-01-01T00:01:00.000Z",
      author: { id: "u-1", name: "Alex" },
    },
  ],
};

const noop = () => {};

function renderPanel(overrides: Partial<ComponentProps<typeof DocsCommentsPanel>> = {}) {
  const onCloseMobile = vi.fn();
  render(
    <TooltipProvider>
      <DocsCommentsPanel
        onCloseMobile={onCloseMobile}
        labels={docsLabels}
        threads={[thread]}
        currentUserId="u-1"
        activeThreadId={null}
        onSelectThread={noop}
        onAddReply={noop}
        onToggleReaction={noop}
        onResolveThread={noop}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onCloseMobile };
}

afterEach(() => {
  cleanup();
});

describe("DocsCommentsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
  });
  it("renders thread content inside the panel", () => {
    renderPanel();

    expect(screen.getByLabelText(docsLabels.commentsSidebarTitle)).toBeTruthy();
    expect(screen.getByText("First comment")).toBeTruthy();
  });

  it("calls onCloseMobile when close button is clicked", () => {
    const { onCloseMobile } = renderPanel();
    fireEvent.click(screen.getByLabelText(docsLabels.commentsCloseSidebar));
    expect(onCloseMobile).toHaveBeenCalledTimes(1);
  });

  it("renders a draft thread card in the panel", () => {
    const draftThread: DocsCommentThread = {
      id: "draft-1",
      anchorText: "selected",
      anchorFrom: 1,
      anchorTo: 9,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [],
    };

    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderPanel({ threads: [], draftThread, activeThreadId: "draft-1" });

    expect(screen.getByPlaceholderText(docsLabels.commentsComposePlaceholder)).toBeTruthy();
    expect(screen.queryByText(docsLabels.commentsEmpty)).toBeNull();
  });
});
