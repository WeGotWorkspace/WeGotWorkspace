/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { TooltipProvider } from "@/ui/tooltip";
import { sampleThread } from "@/text-editor-core/stories/docs-comments-thread-card.stories.fixtures";
import { DocsCommentsThreadCard } from "./docs-comments-thread-card";

afterEach(() => {
  cleanup();
});

const noop = () => {};

function renderCard(overrides: Partial<Parameters<typeof DocsCommentsThreadCard>[0]> = {}) {
  return render(
    <TooltipProvider delayDuration={0}>
      <DocsCommentsThreadCard
        thread={sampleThread}
        labels={docsLabels}
        currentUserId="u-1"
        active
        onSelect={noop}
        onAddReply={noop}
        onToggleReaction={noop}
        onResolve={noop}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("DocsCommentsThreadCard", () => {
  it("resolves with a success IconButton and tooltip label", () => {
    renderCard();

    const resolve = screen.getByRole("button", { name: docsLabels.commentsResolve });
    expect(resolve.className).toContain("icon-button--size-sm");
    expect(resolve.className).toContain("button--severity-success");
    expect(screen.queryByText("Resolve")).toBeNull();
  });
});
