/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import type { DriveFile } from "@/lib/files/drive-models";
import type { DriveViewState } from "@/drive-core/src/use-drive-tree-rows";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show: vi.fn(), showError: vi.fn() }),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
}));

vi.mock("@/drive-core/src/drive-browser", () => ({
  DriveGridView: ({ items }: { items: DriveFile[] }) => (
    <ul aria-label="grid">
      {items.map((file) => (
        <li key={file.id}>{file.title}</li>
      ))}
    </ul>
  ),
}));

vi.mock("@/drive-core/src/drive-list-view", () => ({
  DriveListView: () => null,
}));

const FOLDER = "My Drive/Projects";

function renderPane({
  visibleItems = [],
  viewState = null,
  searchQuery = "",
}: {
  visibleItems?: DriveFile[];
  viewState?: DriveViewState;
  searchQuery?: string;
}) {
  // Only the fields the listing branch reads; the rest of the controller is not under test.
  const controller = {
    labels: driveLabels,
    view: { type: "folder", path: FOLDER },
    searchQuery,
    breadcrumbs: [],
    selectView: vi.fn(),
    visibleItems,
    viewMode: "grid",
    filePreviews: {},
    richPreviews: {},
    setTilesInView: vi.fn(),
    selectedIds: new Set<string>(),
    starred: {},
    viewState,
    uploadEnabled: false,
    selectionBar: null,
  } as unknown as Parameters<typeof DriveMainPane>[0]["controller"];
  return render(<DriveMainPane controller={controller} />);
}

describe("DriveMainPane tree view states (#2063)", () => {
  afterEach(cleanup);

  it("shows the empty state, without a spinner, for a known-empty folder", () => {
    renderPane({ viewState: null });

    expect(screen.getByText(driveLabels.emptyFolder)).toBeTruthy();
    expect(screen.queryByText(driveLabels.allFilesLoading)).toBeNull();
  });

  it("shows the full-pane loading state only during the first sync with no rows", () => {
    renderPane({ viewState: "first-sync" });

    expect(screen.getByText(driveLabels.allFilesLoading)).toBeTruthy();
    expect(screen.queryByText(driveLabels.emptyFolder)).toBeNull();
  });

  it("lists rows that arrived during the first sync instead of the loading state", () => {
    const rows = DRIVE_MOCK_FILES.slice(0, 1);
    renderPane({ visibleItems: rows, viewState: "first-sync" });

    expect(screen.getByText(rows[0]!.title)).toBeTruthy();
    expect(screen.queryByText(driveLabels.allFilesLoading)).toBeNull();
  });

  it("says 'not available offline yet', never empty, offline before the first sync", () => {
    renderPane({ viewState: "not-available" });

    expect(screen.getByRole("status").textContent).toBe(driveLabels.notAvailableOffline);
    expect(screen.queryByText(driveLabels.emptyFolder)).toBeNull();
  });

  it("shows neither empty nor loading before the first read answers", () => {
    const { container } = renderPane({ viewState: "pending" });

    expect(screen.queryByText(driveLabels.emptyFolder)).toBeNull();
    expect(screen.queryByText(driveLabels.allFilesLoading)).toBeNull();
    expect(container.querySelector(".collection-state")).toBeNull();
  });
});
