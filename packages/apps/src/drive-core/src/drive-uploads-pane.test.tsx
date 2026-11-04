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
  const actions = {
    retry: vi.fn(),
    remove: vi.fn(),
    retryAllFailed: vi.fn(),
    resume: vi.fn(),
    chooseFolder: vi.fn(),
  };
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
    // Uploading: the percentage beside the ring, no status line under the name.
    expect(within(busy).getByText("45%")).toBeTruthy();
    expect(within(busy).queryByText(/^Uploading/)).toBeNull();
    // Failed: only the reason, beside the icon; no "Upload failed" line.
    expect(within(failed).queryByText(/^Upload failed/)).toBeNull();
    expect(within(failed).getByRole("img", { name: /Upload failed/ })).toBeTruthy();

    const device = screen.getByText("Contract draft.docx").closest("li")!;
    expect(within(device).getByText(/won't survive/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry all failed" }));
    expect(retryAllFailed).toHaveBeenCalled();

    fireEvent.click(
      within(failed).getByRole("button", { name: "Uploading to Personal / Projects" }),
    );
    expect(onOpenFolder).toHaveBeenCalledWith("My Drive/Projects");
  });

  it("says all uploads are done, without a single folder to go to", () => {
    const { rerender } = renderPane(driveUploadStorySnapshot({ cases: ["waiting"] }));
    rerender(driveUploadStorySnapshot({ cases: [], state: "idle" }));

    expect(screen.getByText("All uploads are done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Go to / })).toBeNull();
  });

  it("hides Retry all failed when no failed file can be retried", () => {
    renderPane(driveUploadStorySnapshot({ cases: ["waiting", "noLocalCopy"] }));
    expect(screen.queryByRole("button", { name: "Retry all failed" })).toBeNull();
  });

  describe("pause and error states (#1522)", () => {
    it("says the server is full, mentions the trash, and resumes on Retry", () => {
      const { resume } = renderPane(
        driveUploadStorySnapshot({ cases: ["serverFull", "waiting"], state: "paused_server_full" }),
      );
      expect(screen.getByText("Uploads are paused: the server is full")).toBeTruthy();
      expect(screen.getByText(/emptying the trash helps/)).toBeTruthy();
      expect(screen.getByText("Waiting for space on the server")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(resume).toHaveBeenCalledOnce();
    });

    it("has no pause notice while the queue runs", () => {
      renderPane(driveUploadStorySnapshot({ cases: ["waiting"] }));
      expect(screen.queryByText("Uploads are paused: the server is full")).toBeNull();
    });

    it("offers Choose another folder on a file whose folder is gone or not writable", () => {
      const { chooseFolder } = renderPane(
        driveUploadStorySnapshot({ cases: ["targetMissing", "forbidden"], state: "idle" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Choose another folder: Minutes.docx" }));
      expect(chooseFolder).toHaveBeenCalledWith(driveUploadStoryItemId("targetMissing"));
      expect(
        screen.getByRole("button", { name: "Choose another folder: Floor plan.pdf" }),
      ).toBeTruthy();
      expect(screen.getByText(/Ask the owner to share the folder/)).toBeTruthy();
    });

    it("offers only Remove on a file that needs https, with the way to Admin", () => {
      renderPane(driveUploadStorySnapshot({ cases: ["insecureContext"], state: "idle" }));
      expect(screen.getByText("Large files need a secure connection (https)")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry Backup.tar" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Choose another folder/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Remove Backup.tar" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open Admin" }).getAttribute("href")).toBe("/admin");
    });

    it("says Retry on a signed-out file goes through sign-in", () => {
      renderPane(driveUploadStorySnapshot({ cases: ["auth"], state: "idle" }));
      expect(screen.getByText(/Retry takes you to sign in/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry Logo.svg" })).toBeTruthy();
    });
  });
});
