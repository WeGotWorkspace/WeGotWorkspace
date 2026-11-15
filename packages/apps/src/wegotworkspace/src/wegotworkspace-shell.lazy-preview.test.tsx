/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyDocsFilePreview } from "@/wegotworkspace/src/wegotworkspace-shell";

vi.mock("@/text-editor-core/src", () => ({
  TextEditor: ({ content }: { content?: string }) => <div data-testid="text-editor">{content}</div>,
}));

afterEach(() => {
  cleanup();
});

// The shell is in the entry chunk, so it loads Docs' editor only when a preview renders (#1628).
describe("LazyDocsFilePreview", () => {
  it("shows the preview's own fallback until the editor chunk has loaded", async () => {
    render(
      <LazyDocsFilePreview fileName="Spec.md" content="# Title" fallback={<p>plain fallback</p>} />,
    );

    expect(screen.getByText("plain fallback")).toBeTruthy();
    expect((await screen.findByTestId("text-editor")).textContent).toContain("# Title");
    expect(screen.queryByText("plain fallback")).toBeNull();
  });
});
