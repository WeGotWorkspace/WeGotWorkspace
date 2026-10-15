import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DriveNewMenu } from "@/drive-core/src/drive-new-menu";

const L = driveLabels;

describe("DriveNewMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  it("creates a folder from the main control without opening a menu", () => {
    const onCreateFolder = vi.fn();
    render(
      <DriveNewMenu
        labels={L}
        onCreateFolder={onCreateFolder}
        onUploadFiles={vi.fn()}
        onCreateMarkdown={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.newFolder }));

    expect(onCreateFolder).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens upload and New document from the chevron", () => {
    const onUploadFiles = vi.fn();
    const onCreateMarkdown = vi.fn();
    render(
      <DriveNewMenu
        labels={L}
        onCreateFolder={vi.fn()}
        onUploadFiles={onUploadFiles}
        onCreateMarkdown={onCreateMarkdown}
      />,
    );

    const chevron = screen.getByRole("button", { name: L.newButtonMenu });
    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: L.uploadFiles }));
    expect(onUploadFiles).toHaveBeenCalledOnce();

    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: L.newMarkdown }));
    expect(onCreateMarkdown).toHaveBeenCalledOnce();
  });

  it("keeps the chevron when only upload is available", () => {
    render(<DriveNewMenu labels={L} onCreateFolder={vi.fn()} onUploadFiles={vi.fn()} />);

    expect(screen.getByRole("button", { name: L.newFolder })).toBeTruthy();
    expect(screen.getByRole("button", { name: L.newButtonMenu })).toBeTruthy();
  });
});
