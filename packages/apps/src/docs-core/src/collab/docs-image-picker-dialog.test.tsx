import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { TooltipProvider } from "@/ui/tooltip";
import { DocsImagePickerDialog } from "./docs-image-picker-dialog";

afterEach(() => {
  cleanup();
});

const sharedProps = {
  open: true,
  currentUsername: "alice",
  groupRoots: [] as const,
  onClose: vi.fn(),
  onSelectFile: vi.fn(),
  onUploadFiles: vi.fn(),
};

describe("DocsImagePickerDialog", () => {
  it("asks to upload or choose from Drive before opening the browser", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DocsImagePickerDialog {...sharedProps} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: docsLabels.insertImageTitle })).toBeTruthy();
    expect(screen.getByText(docsLabels.insertImageChooserDescription)).toBeTruthy();
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog?.className).toContain("docs-dialog-surface");
    expect(dialog?.className).toContain("ui-modal-surface");
    const upload = screen.getByRole("button", { name: docsLabels.insertImageUpload });
    const browse = screen.getByRole("button", { name: docsLabels.insertImageChooseFromDrive });
    expect(upload.className).toContain("button--variant-primary");
    expect(browse.className).toContain("button--variant-outline");
    expect(browse.className).not.toContain("button--variant-primary");
    expect(document.querySelector(".drive-grid")).toBeNull();
    expect(document.querySelector('input[type="file"][accept="image/*"]')).toBeTruthy();
  });

  it("uploads from the OS picker without opening Drive", () => {
    const onUploadFiles = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <DocsImagePickerDialog {...sharedProps} onUploadFiles={onUploadFiles} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: docsLabels.insertImageUpload }));
    expect(document.querySelector(".drive-grid")).toBeNull();
    expect(screen.queryByRole("button", { name: driveLabels.fileSelectDialogInsert })).toBeNull();

    const input = document.querySelector('input[type="file"][accept="image/*"]');
    expect(input).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onUploadFiles).toHaveBeenCalledWith([file]);
  });

  it("opens the Drive browser without an upload control", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DocsImagePickerDialog {...sharedProps} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: docsLabels.insertImageChooseFromDrive }));
    expect(document.querySelector(".drive-grid")).toBeTruthy();
    expect(document.querySelector(".docs-dialog-surface")).toBeTruthy();
    expect(document.querySelector('[data-drive-listing-theme="docs"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: driveLabels.fileSelectDialogInsert })).toBeTruthy();
    expect(screen.queryByRole("button", { name: docsLabels.insertImageUpload })).toBeNull();
    expect(
      screen.queryByRole("button", { name: docsLabels.insertImageChooseFromDrive }),
    ).toBeNull();
  });
});
