import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

const sharedProps = {
  open: true,
  labels: driveLabels,
  files: DRIVE_MOCK_FILES,
  groupPaths: [] as string[],
  view: { type: "folder" as const, path: "My Drive" },
  currentUsername: "alice",
  groupRootNames: new Set<string>(),
  onClose: vi.fn(),
};

describe("DriveMoveToDialog", () => {
  it("keeps Move To folder-destination chrome", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DriveMoveToDialog {...sharedProps} moveIds={["f2"]} onConfirm={vi.fn()} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: driveLabels.moveDialogTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: driveLabels.moveDialogConfirm })).toBeTruthy();
    expect(screen.queryByRole("button", { name: driveLabels.fileSelectDialogInsert })).toBeNull();
    expect(document.querySelector(".destination-list-row")).toBeTruthy();
    expect(document.querySelector('input[type="file"][accept="image/*"]')).toBeNull();
  });

  it("shows Insert and Upload in file-select mode", () => {
    const onSelectFile = vi.fn();
    const onUploadFiles = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <DriveMoveToDialog
          {...sharedProps}
          mode="file-select"
          onSelectFile={onSelectFile}
          onUploadFiles={onUploadFiles}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: driveLabels.fileSelectDialogTitle })).toBeTruthy();
    const insert = screen.getByRole("button", { name: driveLabels.fileSelectDialogInsert });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: driveLabels.fileSelectDialogUpload })).toBeTruthy();
    expect(document.querySelector('input[type="file"][accept="image/*"]')).toBeTruthy();
    expect(document.querySelector(".drive-grid")).toBeTruthy();
    expect(screen.queryByRole("button", { name: driveLabels.moveDialogConfirm })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cover-Photo-Granite.jpg" }));
    expect((insert as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(insert);
    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "f2",
        title: "Cover-Photo-Granite.jpg",
        apiPath: "/users/alice/Cover-Photo-Granite.jpg",
      }),
    );
  });
});
