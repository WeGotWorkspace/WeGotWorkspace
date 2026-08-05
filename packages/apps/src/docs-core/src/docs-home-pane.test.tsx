import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { DocsHomePane, resolveDocsHomeFileCanShare } from "@/docs-core/src/docs-home-pane";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import "@/docs-core/src/docs-home-workspace.css";
import "@/drive-core/src/drive-browser.css";

afterEach(() => {
  cleanup();
});

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

const FILE: DriveFile = {
  id: "doc-1",
  category: "document",
  date: "Now",
  title: "Roadmap.md",
  excerpt: "",
  body: [],
  notebook: "",
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "2.0 KB",
  apiPath: "/users/alice/Roadmap.md",
  location: "My Drive",
};

const FILE2: DriveFile = {
  ...FILE,
  id: "doc-2",
  title: "Notes.md",
  apiPath: "/users/alice/Notes.md",
};

function renderPane(
  viewMode: "list" | "grid" = "list",
  files: DriveFile[] = [FILE],
  batchProps?: {
    batchStar?: (ids: string[]) => void;
    requestMoveSelected?: (ids: string[]) => void;
    requestDeleteSelected?: (ids: string[]) => void;
  },
) {
  const onOpenFile = vi.fn();
  const view = render(
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
        viewMode={viewMode}
        onViewModeChange={() => {}}
        onLoadMore={() => {}}
        onOpenFile={onOpenFile}
        sidebarOpen={false}
        onToggleSidebar={() => {}}
        batchStar={batchProps?.batchStar ?? vi.fn()}
        requestMoveSelected={batchProps?.requestMoveSelected ?? vi.fn()}
        requestDeleteSelected={batchProps?.requestDeleteSelected ?? vi.fn()}
      />
    </TooltipProvider>,
  );
  return { onOpenFile, container: view.container };
}

function selectTwoItems(viewMode: "list" | "grid") {
  const first =
    viewMode === "list"
      ? screen.getByText(FILE.title).closest("tr")!
      : screen.getByRole("button", { name: FILE.title });
  const second =
    viewMode === "list"
      ? screen.getByText(FILE2.title).closest("tr")!
      : screen.getByRole("button", { name: FILE2.title });
  fireEvent.click(first);
  fireEvent.click(second, { metaKey: true });
}

describe("DocsHomePane offline badges", () => {
  it("shows amber pending badge but not green available badge", () => {
    render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[FILE]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          offlinePendingSyncIds={new Set([FILE.id])}
          offlineLabels={{
            offlineAvailable: docsLabels.offlineAvailable,
            offlinePendingSync: docsLabels.syncingOffline,
          }}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </TooltipProvider>,
    );

    const row = screen.getByText(FILE.title).closest("tr")!;
    const badge = row.querySelector(".drive-offline-badge");
    expect(badge).toBeTruthy();
    expect(badge!.className).toContain("drive-offline-badge--pending");
    expect(badge!.className).not.toContain("drive-offline-badge--pinned");
    expect(badge!.getAttribute("aria-label")).toBe("Syncing offline");
  });

  it("shows no badge when synced and not pending", () => {
    const { container } = render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[FILE]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector(".drive-offline-badge")).toBeNull();
  });
});

describe("DocsHomePane shared indicator", () => {
  it("shows public link indicator when file hasPublicShare", () => {
    render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[{ ...FILE, hasPublicShare: true, isShared: true }]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </TooltipProvider>,
    );

    const row = screen.getByText(FILE.title).closest("tr")!;
    const indicator = row.querySelector('.drive-shared-indicator[aria-label="Public link"]');
    expect(indicator).toBeTruthy();
  });

  it("shows team indicator when file hasTeamShare", () => {
    render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[{ ...FILE, hasTeamShare: true, isShared: true }]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </TooltipProvider>,
    );

    const row = screen.getByText(FILE.title).closest("tr")!;
    expect(
      row.querySelector('.drive-shared-indicator[aria-label="Shared with team"]'),
    ).toBeTruthy();
  });

  it("hides shared indicator when file is not shared", () => {
    const { container } = render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[FILE]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector(".drive-shared-indicator")).toBeNull();
  });
});

describe("DocsHomePane file interaction", () => {
  it("selects on single click in list view without opening", () => {
    const { onOpenFile } = renderPane("list");

    const row = screen.getByText(FILE.title).closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(row!.className).toContain("drive-list-row--selected");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens on double click in list view", () => {
    const { onOpenFile } = renderPane("list");

    const row = screen.getByText(FILE.title).closest("tr");
    fireEvent.doubleClick(row!);

    expect(onOpenFile).toHaveBeenCalledWith(FILE);
  });

  it("selects on single click in grid view without opening", () => {
    const { onOpenFile } = renderPane("grid");

    const hit = screen.getByRole("button", { name: FILE.title });
    fireEvent.click(hit);

    expect(hit.closest(".drive-file-tile")!.className).toContain("drive-file-tile--selected");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens on double click in grid view", () => {
    const { onOpenFile } = renderPane("grid");

    const hit = screen.getByRole("button", { name: FILE.title });
    fireEvent.doubleClick(hit);

    expect(onOpenFile).toHaveBeenCalledWith(FILE);
  });
});

describe("DocsHomePane multi-select batch bar", () => {
  it("shows the batch selection bar in list view when two items are selected", () => {
    renderPane("list", [FILE, FILE2]);
    selectTwoItems("list");
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("shows the batch selection bar in grid view when two items are selected", () => {
    renderPane("grid", [FILE, FILE2]);
    selectTwoItems("grid");
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("hides the batch selection bar after Done is clicked", () => {
    renderPane("list", [FILE, FILE2]);
    selectTwoItems("list");
    fireEvent.click(screen.getByRole("button", { name: driveLabels.selectionDone }));
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("shows checkboxes in list view after context menu enters selection mode", () => {
    const { container } = renderPane("list", [FILE, FILE2]);
    fireEvent.contextMenu(screen.getByText(FILE.title).closest("tr")!);
    expect(container.querySelector(".drive-list-row__checkbox")).toBeTruthy();
  });
});

describe("DocsHomePane share actions", () => {
  it("allows Share for search rows with unknown mayShare when shareOperations is wired", () => {
    expect(
      resolveDocsHomeFileCanShare({
        shareEnabled: true,
        apiPath: FILE.apiPath,
        isActive: false,
      }),
    ).toBe(true);
  });

  it("hides Share for the active row while mayShare is still loading", () => {
    expect(
      resolveDocsHomeFileCanShare({
        shareEnabled: true,
        apiPath: FILE.apiPath,
        isActive: true,
        activeMayShare: undefined,
      }),
    ).toBe(false);
  });

  it("renders row overflow when shareOperations is wired", () => {
    render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[FILE]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
          shareOperations={createMockDriveShareOperations()}
          username="alice"
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("hides Share when shareOperations is not wired", () => {
    render(
      <TooltipProvider>
        <DocsHomePane
          labels={docsLabels}
          files={[{ ...FILE, mayShare: true }]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          query=""
          onQueryChange={() => {}}
          viewMode="list"
          onViewModeChange={() => {}}
          onLoadMore={() => {}}
          onOpenFile={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: driveLabels.detailShare })).toBeNull();
  });
});
