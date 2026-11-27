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
  it("is Drive's file picker with an Upload action, no separate chooser step", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DocsImagePickerDialog {...sharedProps} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: docsLabels.insertImageTitle })).toBeTruthy();
    expect(screen.getByText(docsLabels.insertImageChooserDescription)).toBeTruthy();
    expect(document.querySelectorAll("[role='dialog']").length).toBe(1);
    expect(document.querySelector(".docs-dialog-surface")).toBeTruthy();
    expect(document.querySelector('[data-drive-listing-theme="docs"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: driveLabels.fileSelectDialogInsert })).toBeTruthy();
    expect(screen.getByRole("button", { name: docsLabels.insertImageUpload })).toBeTruthy();
  });

  it("uploads from the OS picker without leaving the dialog", () => {
    const onUploadFiles = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <DocsImagePickerDialog {...sharedProps} onUploadFiles={onUploadFiles} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: docsLabels.insertImageUpload }));
    const input = document.querySelector('input[type="file"][accept="image/*"]');
    expect(input).toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onUploadFiles).toHaveBeenCalledWith([file]);
  });
});
