// Docs home renders Drive's grid (#1641 step d, chunk E). Drive loads grid previews
// only for tiles in view (`useDriveTilesInView`); Docs home does not need to, because
// a grid tile only previews an image, and Docs home lists no images. These tests keep
// it that way: a grid of 1,000 documents reads no file bytes, and mounts only a window
// of tiles. If Docs home ever lists a file type with a tile preview, the first test
// fails, and Docs home should pass `tilesInView` like `drive-main-pane.tsx` does.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { DOCS_HOME_LIST_EXTENSIONS } from "@/lib/files/docs-home-listing";
import { inferFileKindFromName } from "@/lib/files/file-name-utils";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { installListLayoutStubs } from "@/workspace-list/src/workspace-list-test-layout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom has no layout or Tailwind: make Docs home's scroller scroll, with a 600 px
 * viewport, and give the grid three columns, as a desktop window would.
 */
function installDesktopGridLayout() {
  installListLayoutStubs(600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("docs-home-pane__scroll") ? 600 : 0;
  });
  const realStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = realStyle(element, pseudo);
    const scroller = element.classList.contains("docs-home-pane__scroll");
    const grid = element.classList.contains("drive-grid");
    if (!scroller && !grid) return style;
    return new Proxy(style, {
      get: (target, key) => {
        if (scroller && key === "overflowY") return "auto";
        if (grid && key === "gridTemplateColumns") return "280px 280px 280px";
        return Reflect.get(target, key);
      },
    });
  });
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

/** 1,000 files of every type the Docs home listing asks the server for. */
function homeFiles(count: number): DriveFile[] {
  return Array.from({ length: count }, (_, index) => {
    const extension = DOCS_HOME_LIST_EXTENSIONS[index % DOCS_HOME_LIST_EXTENSIONS.length];
    const title = `Doc ${String(index + 1).padStart(4, "0")}.${extension}`;
    return {
      id: `doc-${index + 1}`,
      category: "document",
      date: "Now",
      title,
      excerpt: "First line of the document",
      body: [],
      notebook: "",
      tags: [],
      wordCount: 0,
      parent: "My Drive",
      kind: inferFileKindFromName(title),
      size: "2.0 KB",
      apiPath: `/users/alice/${title}`,
      location: "My Drive",
    };
  });
}

function renderGrid(files: DriveFile[], operations: DriveAPIOperations) {
  return render(
    <TooltipProvider>
      <DocsHomePane
        labels={docsLabels}
        files={files}
        loading={false}
        loadingMore={false}
        hasMore={false}
        error={null}
        query=""
        onQueryChange={() => {}}
        viewMode="grid"
        onViewModeChange={() => {}}
        onLoadMore={() => {}}
        onOpenFile={() => {}}
        sidebarOpen={false}
        onToggleSidebar={() => {}}
        operations={operations}
      />
    </TooltipProvider>,
  );
}

describe("DocsHomePane grid with 1,000 documents", () => {
  it("reads no file bytes for tile previews", async () => {
    const readFileBlob = vi.fn(async () => new Blob(["# Doc"], { type: "text/markdown" }));
    renderGrid(homeFiles(1000), { readFileBlob } as unknown as DriveAPIOperations);

    // Previews queue in effects; give them a turn to start.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(readFileBlob).not.toHaveBeenCalled();
  });

  it("mounts only a window of tiles", () => {
    installDesktopGridLayout();
    const { container } = renderGrid(homeFiles(1000), {} as DriveAPIOperations);

    const tiles = container.querySelectorAll(".drive-file-tile[data-list-item-id]");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(100);
    // The Files heading plus 334 rows of three tiles.
    const rows = container.querySelector("[data-workspace-list-rows]");
    expect(rows?.getAttribute("data-workspace-list-rows")).toBe("335");
  });
});
