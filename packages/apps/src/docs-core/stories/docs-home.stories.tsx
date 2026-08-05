import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { WgwUnifiedSearchData, WgwUnifiedSearchResult } from "@/lib/api/wgw/search";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DocsHomeWorkspace } from "@/docs-core/src/docs-home-workspace";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { mapDocsHomeResults, type DocsHomeFetcher } from "@/docs-core/src/use-docs-home-list";
import type { ViewMode } from "@/view-mode-toggle/src/view-mode-toggle";
import "@/docs-core/src/docs-workspace.css";
import "@/docs-core/src/docs-home-workspace.css";

const session: WorkspaceSession = {
  user: {
    displayName: "Alice Rivera",
    username: "alice",
    email: "alice@example.com",
  },
  viewerInboxLabel: "me",
};

const DAY = 24 * 60 * 60;
const NOW = 1_750_000_000;

/** Mixed My Drive + Groups fixtures, newest first. */
const FIXTURES: WgwUnifiedSearchResult[] = [
  fixture(1, "users/alice/Roadmap 2026.md", "Roadmap 2026", 0, { hasPublicShare: true }),
  fixture(2, "groups/engineering/RFC Storage Tiers.md", "RFC: Storage Tiers", 1),
  fixture(3, "users/alice/Notes/Standup.txt", "Standup", 2),
  fixture(4, "groups/design/Brand Voice.markdown", "Brand Voice", 4),
  fixture(5, "users/alice/Personal Journal.md", "Personal Journal", 6),
  fixture(6, "groups/engineering/Onboarding.md", "Onboarding", 9),
  fixture(7, "groups/design/Icon Audit.md", "Icon Audit", 12),
  fixture(8, "users/alice/Archive/Old Plan.txt", "Old Plan", 20),
];

function fixture(
  id: number,
  sourceKey: string,
  title: string,
  ageDays: number,
  options?: { hasShares?: boolean; hasPublicShare?: boolean; hasTeamShare?: boolean },
): WgwUnifiedSearchResult {
  const extension = sourceKey.split(".").pop() ?? "md";
  return {
    id,
    sourceType: "file",
    sourceKey,
    title,
    extension,
    category: "document",
    contentType: extension === "txt" ? "text/plain" : "text/markdown",
    size: 1024 + id * 37,
    modifiedAt: NOW - ageDays * DAY,
    snippet: `Preview of ${title}…`,
    metadata: {
      path: `/${sourceKey}`,
      ...(options?.hasShares ? { hasShares: true } : {}),
      ...(options?.hasPublicShare ? { hasPublicShare: true, hasShares: true } : {}),
      ...(options?.hasTeamShare ? { hasTeamShare: true, hasShares: true } : {}),
    },
  };
}

/**
 * Mock fetcher: 3-per-page browse with offset/hasMore, optional `q` title filter
 * and optional `pathPrefix` drive scope (mirrors the server-side `path_prefix`).
 */
function createPaginatedFetcher(all: WgwUnifiedSearchResult[]): DocsHomeFetcher {
  const PAGE = 3;
  return async (params) => {
    const q = (params.q ?? "").trim().toLowerCase();
    const prefix = params.pathPrefix?.trim() ?? "";
    const scoped = prefix ? all.filter((item) => item.sourceKey.startsWith(`${prefix}/`)) : all;
    const filtered = q ? scoped.filter((item) => item.title.toLowerCase().includes(q)) : scoped;
    const start = params.offset ?? 0;
    const results = filtered.slice(start, start + PAGE);
    const data: WgwUnifiedSearchData = {
      query: params.q ?? "",
      limit: params.limit ?? PAGE,
      offset: start,
      hasMore: start + results.length < filtered.length,
      sources: params.sources ?? ["file"],
      filters: {
        categories: params.categories,
        extensions: params.extensions,
        path_prefix: prefix || null,
      },
      results,
    };
    return data;
  };
}

/**
 * In-memory drive operations so the row actions (star/download/rename/move/trash)
 * are functional in Storybook. Stars toggle optimistically; mutations resolve no-op.
 */
function createMockHomeOperations(
  initialStars: string[] = [],
  myDriveNames: string[] = [],
): DriveAPIOperations {
  const stars = new Set(initialStars);
  const data = {} as DriveUIData;
  const listing = {
    directory: { files: myDriveNames.map((name) => ({ name })) },
  } as unknown as DriveUIData;
  return {
    refreshState: async () => data,
    changeDir: async () => data,
    listDirectory: async () => listing,
    search: async () => [],
    createFolder: async () => data,
    createFile: async () => data,
    renameItem: async () => data,
    deleteItems: async () => data,
    downloadFile: async () => {},
    readFileBlob: async () => new Blob(),
    checkUploadReady: async () => {},
    listStars: async () => Array.from(stars),
    listEntriesByPaths: async () => [],
    setStar: async ({ path, starred }) => {
      if (starred) stars.add(path);
      else stars.delete(path);
    },
    uploadFiles: async () => data,
  };
}

const meta: Meta<typeof DocsHomeWorkspace> = {
  title: "Apps/Docs/Home",
  component: DocsHomeWorkspace,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    session,
    operations: createMockHomeOperations(["/users/alice/Roadmap 2026.md"]),
    shareOperations: createMockDriveShareOperations(),
    onOpenFile: () => {},
    onCreateDocument: () => {},
    onLogout: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DocsHomeWorkspace>;

export const Default: Story = {
  name: "Browse (paginated)",
  tags: ["vitest-ci"],
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("button", { name: "New document" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "All docs" })).toBeInTheDocument();
    await expect(canvas.getByText("Drives")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "My Drive" })).toBeInTheDocument();

    // Docs home hides the redundant "Kind" column (everything is a document).
    await expect(canvas.queryByRole("columnheader", { name: "Kind" })).not.toBeInTheDocument();

    const engineering = await canvas.findByRole("button", { name: "engineering" });
    await expect(await canvas.findByText("Roadmap 2026")).toBeInTheDocument();

    await userEvent.click(engineering);

    await waitFor(async () => {
      await expect(canvas.queryByText("Roadmap 2026")).not.toBeInTheDocument();
    });
    await expect(canvas.getByText("RFC: Storage Tiers")).toBeInTheDocument();
  },
};

/** Row overflow menu includes Share when share operations are wired (Drive home parity). */
export const ShareFromRowMenu: Story = {
  name: "Share (row menu)",
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
    shareOperations: createMockDriveShareOperations(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const row = (await canvas.findByText("Roadmap 2026")).closest("tr");
    if (!row) throw new Error("Expected Roadmap 2026 in a list row");

    await userEvent.click(within(row).getByRole("button", { name: "More actions" }));
    await userEvent.click(await body.findByRole("menuitem", { name: driveLabels.detailShare }));
    await expect(
      await body.findByRole("dialog", { name: "Share Roadmap 2026" }),
    ).toBeInTheDocument();
  },
};

/** Matches Drive: single click selects the row, double click opens it. */
export const SelectVsOpen: Story = {
  name: "Select vs open (SST)",
  tags: ["vitest-ci"],
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
    onOpenFile: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const cell = await canvas.findByText("Roadmap 2026");
    const row = cell.closest("tr");
    if (!row) throw new Error("Expected the document to render in a list row");

    await userEvent.click(cell);
    await waitFor(() => expect(row).toHaveClass("drive-list-row--selected"));
    await expect(args.onOpenFile).not.toHaveBeenCalled();

    await userEvent.dblClick(cell);
    await waitFor(() => expect(args.onOpenFile).toHaveBeenCalled());
  },
};

/** The create button resolves a non-colliding name from the live My Drive listing. */
export const CreateUniqueName: Story = {
  name: "Create (unique name)",
  tags: ["vitest-ci"],
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
    // Live listing already contains Untitled.md, so the create flow must skip it.
    operations: createMockHomeOperations([], ["Untitled.md"]),
    onCreateDocument: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const createButton = await canvas.findByRole("button", { name: "New document" });
    await userEvent.click(createButton);
    await body.findByRole("dialog", { name: "New document" });
    await userEvent.click(await body.findByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(args.onCreateDocument).toHaveBeenCalledWith("/users/alice/Untitled 2.md"),
    );
  },
};

export const Empty: Story = {
  args: {
    fetcher: createPaginatedFetcher([]),
  },
};

/** Cached browse listing with muted unavailable rows (mock tier). */
export const OfflineCachedListing: Story = {
  name: "Offline (cached listing)",
  render: () => <OfflineCachedListingHarness />,
  parameters: {
    docs: {
      description: {
        story:
          "Docs home browse served from cached unified-search rows with muted rows for docs not available offline.",
      },
    },
  },
};

function OfflineCachedListingHarness() {
  const files = mapDocsHomeResults(FIXTURES, session.user.username ?? "alice");
  return (
    <div className="docs-workspace docs-home-workspace" style={{ height: "100dvh" }}>
      <DocsHomePane
        labels={docsLabels}
        files={files}
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
    </div>
  );
}

/** Pane-only surface (header + list) with static mock data and grid/list toggle. */
export const Pane: StoryObj<typeof DocsHomePane> = {
  render: () => <DocsHomePaneHarness />,
  parameters: {
    docs: {
      description: {
        story: "The `DocsHomePane` in isolation: view-mode toggle, Location column, and load more.",
      },
    },
  },
};

/** Grid tiles use the document kind icon (no markdown body preview). */
export const GridView: StoryObj<typeof DocsHomePane> = {
  name: "Grid view",
  tags: ["vitest-ci"],
  render: () => <DocsHomePaneHarness initialViewMode="grid" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Roadmap 2026" })).toBeInTheDocument();
    await expect(canvas.queryByText(/Preview of Roadmap/i)).not.toBeInTheDocument();
  },
};

function DocsHomePaneHarness({ initialViewMode = "list" }: { initialViewMode?: ViewMode }) {
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [query, setQuery] = useState("");
  const files = mapDocsHomeResults(FIXTURES, session.user.username ?? "alice");
  return (
    <div className="docs-workspace docs-home-workspace" style={{ height: "100dvh" }}>
      <DocsHomePane
        labels={docsLabels}
        files={files}
        loading={false}
        loadingMore={false}
        hasMore
        error={null}
        query={query}
        onQueryChange={setQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onLoadMore={() => {}}
        onOpenFile={() => {}}
        sidebarOpen={false}
        onToggleSidebar={() => {}}
      />
    </div>
  );
}
