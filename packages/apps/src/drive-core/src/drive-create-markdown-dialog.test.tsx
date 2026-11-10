import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveCreateMarkdownDialog } from "@/drive-core/src/drive-create-markdown-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

function renderDialog(props: { hideName?: boolean; onConfirm: () => void }) {
  return render(
    <TooltipProvider delayDuration={0}>
      <DriveCreateMarkdownDialog
        open
        labels={driveLabels}
        defaultName="Untitled.md"
        initialBrowsePath="My Drive"
        files={DRIVE_MOCK_FILES}
        groupPaths={[]}
        view={{ type: "folder", path: "My Drive" }}
        currentUsername="alice"
        groupRootNames={new Set<string>()}
        onClose={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

function confirmButton() {
  return screen.getByRole("button", {
    name: driveLabels.createMarkdownDialogConfirm,
  }) as HTMLButtonElement;
}

function pickFirstFolder() {
  const row = document.querySelector(".destination-list-row");
  if (!row) throw new Error("no folder row");
  fireEvent.click(row);
}

describe("DriveCreateMarkdownDialog", () => {
  it("asks for a name and a folder", () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    expect(
      screen.getByPlaceholderText(driveLabels.createMarkdownDialogNamePlaceholder),
    ).toBeTruthy();
    pickFirstFolder();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("Untitled.md", expect.any(String));
  });

  it("with hideName asks only for the folder", () => {
    const onConfirm = vi.fn();
    renderDialog({ hideName: true, onConfirm });
    expect(
      screen.queryByPlaceholderText(driveLabels.createMarkdownDialogNamePlaceholder),
    ).toBeNull();
    pickFirstFolder();
    // No name to fill in: a folder is enough to confirm.
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(expect.any(String), expect.any(String));
  });
});
