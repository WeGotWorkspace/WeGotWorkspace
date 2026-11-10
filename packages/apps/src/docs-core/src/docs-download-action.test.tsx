/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Printer } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsHeaderActions } from "@/docs-core/src/docs-header-actions";
import { docsDownloadHeaderAction } from "@/docs-core/src/docs-download-action";
import { docsCollabHeaderActions } from "@/text-editor-core/docs-collab/docs-collab-header-actions";
import type { Editor } from "@tiptap/react";

beforeAll(() => {
  // Radix positions the menu with these; jsdom has none of them.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  cleanup();
});

function renderWithDownload({ busy = false, disabled = false } = {}) {
  const downloadWord = vi.fn();
  const { container } = render(
    <TooltipProvider>
      <div className="docs-workspace">
        <DocsHeaderActions
          actions={[
            { id: "print", label: "Print", icon: <Printer />, onClick: vi.fn() },
            docsDownloadHeaderAction({
              labels: docsLabels,
              download: { busy, downloadWord },
              disabled,
            }),
          ]}
        />
      </div>
    </TooltipProvider>,
  );
  return { container: container as HTMLElement, downloadWord };
}

describe("Doc header Download menu", () => {
  it("opens from the wide row and downloads a Word file", () => {
    const { container, downloadWord } = renderWithDownload();
    const row = container.querySelector(".docs-workspace__header-actions-row") as HTMLElement;
    fireEvent.keyDown(within(row).getByRole("button", { name: "Download" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Word \(\.docx\)/ }));
    expect(downloadWord).toHaveBeenCalledTimes(1);
  });

  it("is a submenu in the phone menu", () => {
    const { downloadWord } = renderWithDownload();
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Download/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Word \(\.docx\)/ }));
    expect(downloadWord).toHaveBeenCalledTimes(1);
  });

  it("is disabled while a download runs and when the action is unavailable", () => {
    for (const state of [{ busy: true }, { disabled: true }]) {
      const { container } = renderWithDownload(state);
      const row = container.querySelector(".docs-workspace__header-actions-row") as HTMLElement;
      expect(
        (within(row).getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      cleanup();
    }
  });
});

describe("docsCollabHeaderActions", () => {
  const base = {
    labels: docsLabels,
    editor: {} as Editor,
    onToggleViewSource: vi.fn(),
    sourceLockedByCollab: false,
    reviewPanelOpen: false,
  };

  it("puts Download right after Print", () => {
    const actions = docsCollabHeaderActions({
      ...base,
      viewSource: false,
      download: { busy: false, downloadWord: vi.fn() },
    });
    expect(actions.map((a) => a.id)).toEqual(["print", "download", "view-source"]);
    expect(actions[1].disabled).toBe(false);
  });

  it("disables Download in source view, like Print", () => {
    const actions = docsCollabHeaderActions({
      ...base,
      viewSource: true,
      download: { busy: false, downloadWord: vi.fn() },
    });
    expect(actions.find((a) => a.id === "download")?.disabled).toBe(true);
  });

  it("leaves Download out when the shell offers none", () => {
    const actions = docsCollabHeaderActions({ ...base, viewSource: false });
    expect(actions.map((a) => a.id)).not.toContain("download");
  });
});
