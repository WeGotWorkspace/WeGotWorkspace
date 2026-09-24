/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "@/file-preview/src/file-preview";
import "@/file-preview/src/file-preview.css";

vi.mock("@/text-editor-core/src", () => ({
  TextEditor: ({ content, editable }: { content?: string; editable?: boolean }) => (
    <div data-testid="text-editor" data-editable={String(editable ?? true)}>
      {content}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("FilePreview tile variant", () => {
  it("mounts read-only docs editor for rich markdown tiles when in view", () => {
    render(
      <FilePreview
        variant="tile"
        fileKind="doc"
        fileName="Spec.md"
        preview={{ kind: "docs", content: "# Title\n\nBody" }}
      />,
    );

    expect(screen.getByTestId("text-editor").getAttribute("data-editable")).toBe("false");
    expect(screen.getByTestId("file-preview-tile-docs-lazy").getAttribute("data-mounted")).toBe(
      "true",
    );
  });

  it("defers docs editor mount until the tile intersects the viewport", async () => {
    class MockIntersectionObserver {
      static last: MockIntersectionObserver | null = null;

      constructor(private callback: IntersectionObserverCallback) {
        MockIntersectionObserver.last = this;
      }

      observe() {}

      disconnect() {}

      emit(isIntersecting: boolean) {
        this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
      }
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    render(
      <FilePreview
        variant="tile"
        fileKind="doc"
        fileName="Spec.md"
        preview={{ kind: "docs", content: "# Title\n\nBody" }}
      />,
    );

    const lazy = screen.getByTestId("file-preview-tile-docs-lazy");
    expect(lazy.getAttribute("data-mounted")).toBe("false");
    expect(screen.queryByTestId("text-editor")).toBeNull();

    MockIntersectionObserver.last?.emit(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("text-editor")).toBeTruthy();
    expect(lazy.getAttribute("data-mounted")).toBe("true");
  });

  it("shows kind-icon fallback for empty docs content instead of a blank editor sheet", () => {
    const { container } = render(
      <FilePreview
        variant="detail"
        fileKind="doc"
        fileName="Empty.md"
        preview={{ kind: "docs", content: "" }}
      />,
    );

    expect(screen.queryByTestId("text-editor")).toBeNull();
    expect(container.querySelector(".file-preview__fallback")).toBeTruthy();
  });
});
