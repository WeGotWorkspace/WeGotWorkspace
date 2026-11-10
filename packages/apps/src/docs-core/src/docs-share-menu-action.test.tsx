/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsHeaderActions } from "@/docs-core/src/docs-header-actions";
import { docsShareMenuHeaderAction } from "@/docs-core/src/docs-share-menu-action";
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

function renderShareMenu({ busy = false, contentUnavailable = false, withInvite = true } = {}) {
  const download = { busy, downloadMarkdown: vi.fn(), downloadWord: vi.fn() };
  const onPrint = vi.fn();
  const invite = { onClick: vi.fn() };
  const { container } = render(
    <TooltipProvider>
      <div className="docs-workspace">
        <DocsHeaderActions
          actions={[
            docsShareMenuHeaderAction({
              labels: docsLabels,
              invite: withInvite ? invite : undefined,
              download,
              onPrint,
              contentUnavailable,
            }),
          ]}
        />
      </div>
    </TooltipProvider>,
  );
  return { container: container as HTMLElement, download, onPrint, invite };
}

function shareButton(container: HTMLElement) {
  const row = container.querySelector(".docs-workspace__header-actions-row--end") as HTMLElement;
  return within(row).getByRole("button", { name: "Share" }) as HTMLButtonElement;
}

function openWideShare(container: HTMLElement) {
  fireEvent.keyDown(shareButton(container), { key: "Enter" });
}

describe("Doc header Share menu", () => {
  it("groups Invite others, the downloads, then Print", () => {
    const { container } = renderShareMenu();
    openWideShare(container);
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Invite others", "Download Markdown (.md)", "Download Word (.docx)", "Print"]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
  });

  it("runs the chosen item from the wide row", () => {
    const { container, download, onPrint, invite } = renderShareMenu();
    for (const [name, spy] of [
      [/Invite others/, invite.onClick],
      [/Markdown/, download.downloadMarkdown],
      [/Word/, download.downloadWord],
      [/Print/, onPrint],
    ] as const) {
      openWideShare(container);
      fireEvent.click(screen.getByRole("menuitem", { name }));
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("is a submenu in the phone menu", () => {
    const { download } = renderShareMenu();
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Share/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Word \(\.docx\)/ }));
    expect(download.downloadWord).toHaveBeenCalledTimes(1);
  });

  it("keeps Invite others when downloads and Print are unavailable", () => {
    const { container } = renderShareMenu({ contentUnavailable: true });
    expect(shareButton(container).disabled).toBe(false);
    openWideShare(container);
    const disabled = (name: RegExp) =>
      screen.getByRole("menuitem", { name }).hasAttribute("data-disabled");
    expect(disabled(/Invite others/)).toBe(false);
    for (const name of [/Markdown/, /Word/, /Print/]) expect(disabled(name)).toBe(true);
  });

  it("is disabled without Invite others while nothing else can run", () => {
    for (const state of [{ busy: true }, { contentUnavailable: true }]) {
      const { container } = renderShareMenu({ ...state, withInvite: false });
      expect(shareButton(container).disabled).toBe(true);
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
  const download = { busy: false, downloadMarkdown: vi.fn(), downloadWord: vi.fn() };
  const share = { label: "Share", onClick: vi.fn() };

  it("has one Share menu, with its label on wide screens", () => {
    const actions = docsCollabHeaderActions({ ...base, viewSource: false, download, share });
    expect(actions.map((a) => a.id)).toEqual(["share"]);
    expect(actions[0].showLabel).toBe(true);
    expect(actions[0].items?.map((item) => item.id)).toEqual([
      "invite",
      "group-1",
      "download-markdown",
      "download-word",
      "group-2",
      "print",
    ]);
  });

  it("omits Download Markdown when the Doc is not Markdown", () => {
    const actions = docsCollabHeaderActions({
      ...base,
      viewSource: false,
      download: { busy: false, downloadWord: vi.fn() },
      share,
    });
    expect(actions[0].items?.map((item) => item.id)).toEqual([
      "invite",
      "group-1",
      "download-word",
      "group-2",
      "print",
    ]);
  });

  it("keeps only Print when the shell offers no sharing or downloads", () => {
    const actions = docsCollabHeaderActions({ ...base, viewSource: false });
    expect(actions.find((a) => a.id === "share")?.items?.map((item) => item.id)).toEqual(["print"]);
  });
});
