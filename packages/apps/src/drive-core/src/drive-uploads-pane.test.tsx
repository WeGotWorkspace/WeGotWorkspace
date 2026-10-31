/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { driveFilesFromUploadQueue } from "@/drive-core/src/drive-upload-files";
import {
  buildDriveUploadQueueModel,
  DriveUploadQueueProvider,
} from "@/drive-core/src/drive-upload-queue";
import {
  driveUploadStoryItemId,
  driveUploadStorySnapshot,
} from "@/drive-core/src/drive-upload-story-fixtures";
import { DriveUploadsPane } from "@/drive-core/src/drive-uploads-pane";
import type { DriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";

afterEach(cleanup);

function renderPane(snapshot: DriveUploadQueueSnapshot) {
  const actions = { retry: vi.fn(), remove: vi.fn(), retryAllFailed: vi.fn() };
  const onOpenFolder = vi.fn();
  const files = driveFilesFromUploadQueue(snapshot, "demo.user");
  const ui = (next: DriveUploadQueueSnapshot) => (
    <DriveUploadQueueProvider value={buildDriveUploadQueueModel(next, actions)}>
      <DriveUploadsPane
        files={driveFilesFromUploadQueue(next, "demo.user")}
        searchActive={false}
        onOpenFolder={onOpenFolder}
      />
    </DriveUploadQueueProvider>
  );
  const view = render(ui(snapshot));
  return {
    ...actions,
    onOpenFolder,
    files,
    rerender: (next: DriveUploadQueueSnapshot) => view.rerender(ui(next)),
  };
}

describe("DriveUploadsPane", () => {
  it("lists every file with its folder, status, and the actions that apply", () => {
    const { retry, remove, retryAllFailed, onOpenFolder } = renderPane(driveUploadStorySnapshot());

    expect(screen.getByText("8 files · 2 failed")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(8);

    const failed = screen.getByText("Scan 0042.png").closest("li")!;
    fireEvent.click(within(failed).getByRole("button", { name: "Retry Scan 0042.png" }));
    expect(retry).toHaveBeenCalledWith(driveUploadStoryItemId("failed"));

    const gone = screen.getByText("Interview notes.txt").closest("li")!;
    expect(within(gone).queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(within(gone).getByText(/Add the file again/)).toBeTruthy();
    fireEvent.click(within(gone).getByRole("button", { name: "Remove Interview notes.txt" }));
    expect(remove).toHaveBeenCalledWith(driveUploadStoryItemId("noLocalCopy"));

    const busy = screen.getByText("Launch video.mp4").closest("li")!;
    expect(within(busy).queryByRole("button", { name: /Remove/ })).toBeNull();
    const ring = within(busy).getByRole("progressbar", { name: "Upload of Launch video.mp4" });
    expect(ring.getAttribute("aria-valuenow")).toBe("45");

    const device = screen.getByText("Contract draft.docx").closest("li")!;
    expect(within(device).getByText(/won't survive/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry all failed" }));
    expect(retryAllFailed).toHaveBeenCalled();

    fireEvent.click(
      within(failed).getByRole("button", { name: "Uploading to Personal / Projects" }),
    );
    expect(onOpenFolder).toHaveBeenCalledWith("My Drive/Projects");
  });

  it("says all uploads are done and links to the last batch's folder", () => {
    const { rerender, onOpenFolder } = renderPane(driveUploadStorySnapshot({ cases: ["waiting"] }));
    rerender(driveUploadStorySnapshot({ cases: [], state: "idle" }));

    expect(screen.getByText("All uploads are done")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Personal / Projects" }));
    expect(onOpenFolder).toHaveBeenCalledWith("My Drive/Projects");
  });

  it("hides Retry all failed when no failed file can be retried", () => {
    renderPane(driveUploadStorySnapshot({ cases: ["waiting", "noLocalCopy"] }));
    expect(screen.queryByRole("button", { name: "Retry all failed" })).toBeNull();
  });
});
