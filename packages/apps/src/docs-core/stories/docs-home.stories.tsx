import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DocsHomeWorkspace } from "@/docs-core/src/docs-home-workspace";
import { DocsHomePane } from "@/docs-core/src/docs-home-pane";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { mapDocsHomeResults } from "@/docs-core/src/use-docs-home-list";
import type { ViewMode } from "@/view-mode-toggle/src/view-mode-toggle";
import {
  createDocsHomePaginatedFetcher,
  createMockDocsHomeOperations,
  DOCS_HOME_STORY_FIXTURES,
  docsHomeStorySession,
  mapStoryDocsHomeResults,
} from "@/docs-core/stories/docs-home-story-shared";
import "@/docs-core/src/docs-workspace.css";
import "@/docs-core/src/docs-home-workspace.css";

const session = docsHomeStorySession;
const FIXTURES = DOCS_HOME_STORY_FIXTURES;
const createPaginatedFetcher = createDocsHomePaginatedFetcher;
const createMockHomeOperations = createMockDocsHomeOperations;

const meta: Meta<typeof DocsHomeWorkspace> = {
  title: "Shared/Docs/Home",
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

/** Chrome Home lives under Branding/Docs — browse / sidebar navigation SST. */
export const Default: Story = {
  name: "Browse (paginated)",
  tags: ["vitest-ci"],
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("button", { name: "New document" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "My Docs" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Shared with me" })).toBeInTheDocument();
    await expect(canvas.getByText("My Drives")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Personal" })).toBeInTheDocument();

    // Docs home hides the redundant "Kind" column (everything is a document).
    await expect(canvas.queryByRole("columnheader", { name: "Kind" })).not.toBeInTheDocument();

    const engineering = await canvas.findByRole("button", { name: "engineering" });
    await expect(await canvas.findByText("Roadmap 2026")).toBeInTheDocument();
    // All docs merges docs-compatible Shared with me entries into the browse listing.
    await expect(await canvas.findByText("Shared Notes.md")).toBeInTheDocument();
    await expect(await canvas.findByText("Shared by hana")).toBeInTheDocument();

    await userEvent.click(engineering);

    await waitFor(async () => {
      await expect(canvas.queryByText("Roadmap 2026")).not.toBeInTheDocument();
    });
    await expect(canvas.getByRole("heading", { name: "engineering" })).toBeInTheDocument();
    await expect(canvas.getByText("RFC: Storage Tiers")).toBeInTheDocument();
    await expect(canvas.queryByText("Shared Notes.md")).not.toBeInTheDocument();
  },
};

/** Shared with me lists docs-compatible shares only (md/txt), not folders or binaries. */
export const SharedWithMe: Story = {
  name: "Shared with me",
  tags: ["vitest-ci"],
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
    shareOperations: createMockDriveShareOperations(),
    onOpenFile: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: "Shared with me" }));

    await expect(
      await canvas.findByRole("heading", { name: "Shared with me" }),
    ).toBeInTheDocument();
    await expect(await canvas.findByText("Shared Notes.md")).toBeInTheDocument();
    await expect(canvas.getByText("Shared by hana")).toBeInTheDocument();
    await expect(canvas.queryByText("Client Deck")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Bindery-Walkthrough.mov")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Roadmap 2026")).not.toBeInTheDocument();

    const cell = await canvas.findByText("Shared Notes.md");
    await userEvent.dblClick(cell);
    await waitFor(() =>
      expect(args.onOpenFile).toHaveBeenCalledWith("/users/hana/Shared Notes.md"),
    );
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
    // Wait for All docs + shared merge so the list is stable before opening menus.
    await expect(await canvas.findByText("Shared Notes.md")).toBeInTheDocument();
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
    const dialog = await body.findByRole("dialog", { name: "New document" });
    const dialogScope = within(dialog);
    const personalRow = dialogScope.getByText("Personal").closest("tr");
    await expect(personalRow).toHaveClass("destination-list-row--selected");
    await userEvent.click(await dialogScope.findByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(args.onCreateDocument).toHaveBeenCalledWith("/users/alice/Untitled 2.md"),
    );
  },
};

/** Sidebar drive selection preselects that drive in the New document destination picker. */
export const CreateFromSelectedDrive: Story = {
  name: "Create (from selected drive)",
  tags: ["vitest-ci"],
  args: {
    fetcher: createPaginatedFetcher(FIXTURES),
    operations: createMockHomeOperations([], ["Untitled.md"]),
    onCreateDocument: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(await canvas.findByRole("button", { name: "engineering" }));
    await expect(await canvas.findByRole("heading", { name: "engineering" })).toBeInTheDocument();

    await userEvent.click(await canvas.findByRole("button", { name: "New document" }));
    const dialog = await body.findByRole("dialog", { name: "New document" });
    const dialogScope = within(dialog);

    await expect(dialogScope.getByText("Personal")).toBeInTheDocument();
    const engineeringRow = dialogScope.getByText("engineering").closest("tr");
    await expect(engineeringRow).toHaveClass("destination-list-row--selected");

    await userEvent.click(await dialogScope.findByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(args.onCreateDocument).toHaveBeenCalledWith("/groups/engineering/Untitled 2.md"),
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
  const files = mapStoryDocsHomeResults(FIXTURES);
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
