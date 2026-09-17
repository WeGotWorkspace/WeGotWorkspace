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

  it("shows Insert without Upload in file-select mode", () => {
    const onSelectFile = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <DriveMoveToDialog {...sharedProps} mode="file-select" onSelectFile={onSelectFile} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: driveLabels.fileSelectDialogTitle })).toBeTruthy();
    const insert = screen.getByRole("button", { name: driveLabels.fileSelectDialogInsert });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(document.querySelector('input[type="file"][accept="image/*"]')).toBeNull();
    expect(document.querySelector(".drive-grid")).toBeTruthy();
    expect(document.querySelector("[data-drive-listing-theme]")).toBeNull();
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

  it("marks Docs file-select listing chrome for Docs tokens", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DriveMoveToDialog
          {...sharedProps}
          mode="file-select"
          dialogSurfaceClassName="docs-dialog-surface"
          onSelectFile={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(document.querySelector('[data-drive-listing-theme="docs"]')).toBeTruthy();
    expect(document.querySelector(".docs-dialog-surface")).toBeTruthy();
  });
});
