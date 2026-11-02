/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveFolderListingError } from "@/drive-core/src/use-drive-folder-listing-sync";

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
  DriveListView: () => null,
}));

const FOLDER = "My Drive/Projects";

function renderPane({
  visibleItems = [],
  folderListingError = null,
  folderListingPending = false,
}: {
  visibleItems?: DriveFile[];
  folderListingError?: DriveFolderListingError | null;
  folderListingPending?: boolean;
}) {
  const retryFolderListing = vi.fn();
  // Only the fields the listing branch reads; the rest of the controller is not under test.
  const controller = {
    labels: driveLabels,
    view: { type: "folder", path: FOLDER },
    searchQuery: "",
    breadcrumbs: [],
    selectView: vi.fn(),
    visibleItems,
    viewMode: "grid",
    filePreviews: {},
    richPreviews: {},
    setTilesInView: vi.fn(),
    selectedIds: new Set<string>(),
    starred: {},
    folderListingPending,
    folderListingError,
    retryFolderListing,
    listLoading: false,
    uploadEnabled: false,
    uploadProgress: null,
    selectionBar: null,
  } as unknown as Parameters<typeof DriveMainPane>[0]["controller"];
  render(<DriveMainPane controller={controller} />);
  return { retryFolderListing };
}

describe("DriveMainPane folder listing states", () => {
  afterEach(cleanup);

  it("shows an error, not 'This folder is empty', when the folder failed to load", () => {
    const { retryFolderListing } = renderPane({
      folderListingError: { path: FOLDER, message: "FileNode query+get failed" },
    });

    expect(screen.getByRole("alert").textContent).toBe(driveLabels.folderListingFailed);
    expect(screen.queryByText(driveLabels.emptyFolder)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: driveLabels.folderListingRetry }));
    expect(retryFolderListing).toHaveBeenCalledTimes(1);
  });

  it("shows 'This folder is empty' for a folder that loaded with no rows", () => {
    renderPane({});

    expect(screen.getByText(driveLabels.emptyFolder)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores an error that belongs to another folder", () => {
    renderPane({ folderListingError: { path: "My Drive/Other", message: "failed" } });

    expect(screen.getByText(driveLabels.emptyFolder)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps showing cached rows when the live load failed", () => {
    const cached = DRIVE_MOCK_FILES.slice(0, 1);
    renderPane({
      visibleItems: cached,
      folderListingError: { path: FOLDER, message: "failed" },
    });

    expect(screen.getByText(cached[0]!.title)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the loading state while a retry is pending", () => {
    renderPane({ folderListingPending: true });

    expect(screen.getByText(driveLabels.folderListingLoading)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
