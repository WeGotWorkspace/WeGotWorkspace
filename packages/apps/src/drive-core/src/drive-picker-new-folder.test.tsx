import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import {
  drivePickerFolderNameError,
  suggestDrivePickerFolderName,
} from "@/drive-core/src/drive-picker-new-folder-utils";
import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import type { DrivePickerNewFolderControl } from "@/drive-core/src/drive-picker-new-folder-utils";
import { optimisticDriveFolder } from "@/drive-core/src/drive-file-utils";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

// One set for every render: a new one re-runs the picker's listing.
const NO_GROUPS = new Set<string>();

type Entry = {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  time: number;
  permissions: number;
  myRights?: { mayManageStructure: boolean };
};

const dir = (name: string, mayManageStructure = true): Entry => ({
  name,
  path: `/users/alice/${name}`,
  type: "dir",
  size: 0,
  time: 0,
  permissions: 0,
  myRights: { mayManageStructure },
});

function fakeOperations(createFolder?: DriveAPIOperations["createFolder"]) {
  const folders: Record<string, Entry[]> = {
    "/users/alice": [dir("Reports"), dir("Archive", false)],
  };
  const listDirectory = vi.fn(async (at: string) => ({
    user: { username: "alice", name: "alice", role: "user" as const, roots: [] },
    cwd: at,
    directory: { location: at, files: folders[at] ?? [] },
  }));
  const create =
    createFolder ??
    vi.fn(async ({ cwd, name }: { cwd: string; name: string }) => {
      folders[cwd] = [...(folders[cwd] ?? []), { ...dir(name), path: `${cwd}/${name}` }];
      return listDirectory(cwd);
    });
  return {
    operations: { listDirectory, createFolder: create } as unknown as DriveAPIOperations,
    create,
  };
}

function renderMove(
  operations: DriveAPIOperations,
  onConfirm = vi.fn(),
  onClose = vi.fn(),
  viewPath = "My Drive",
) {
  render(
    <TooltipProvider delayDuration={0}>
      <DriveMoveToDialog
        open
        labels={driveLabels}
        files={[]}
        groupPaths={[]}
        moveIds={[]}
        view={{ type: "folder", path: viewPath }}
        operations={operations}
        currentUsername="alice"
        groupRootNames={NO_GROUPS}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    </TooltipProvider>,
  );
  return { onConfirm, onClose };
}

const newFolderButton = () => screen.getByRole("button", { name: driveLabels.pickerNewFolder });
const nameField = () =>
  screen.getByLabelText(driveLabels.pickerNewFolderNameLabel) as HTMLInputElement;

describe("picker New folder", () => {
  it("sits in the footer before Cancel and opens a selected, ready-to-type name", async () => {
    renderMove(fakeOperations().operations);
    await screen.findByText("Reports");

    const footerButtons = [
      ...document.querySelectorAll("[data-slot='dialog-footer'] button, .ui-modal-footer button"),
    ].map((node) => node.textContent?.trim());
    expect(footerButtons.indexOf(driveLabels.pickerNewFolder)).toBe(0);

    fireEvent.click(newFolderButton());
    const field = nameField();
    expect(field.value).toBe("New folder");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe("New folder".length);
  });

  it("creates with the create-folder action, shows it in place and selects it", async () => {
    const { operations, create } = fakeOperations();
    const { onConfirm } = renderMove(operations);
    await screen.findByText("Reports");

    fireEvent.click(newFolderButton());
    fireEvent.change(nameField(), { target: { value: "Invoices" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });

    expect(create).toHaveBeenCalledWith({ cwd: "/users/alice", name: "Invoices" });
    const row = (await screen.findByText("Invoices")).closest("tr");
    expect(row?.className).toContain("drive-list-row--selected");

    const confirm = screen.getByRole("button", { name: driveLabels.moveDialogConfirm });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("My Drive/Invoices");
  });

  it("holds the dialog's confirm until the create has resolved", async () => {
    let finish: () => void = () => {};
    const { operations } = fakeOperations(
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(undefined);
          }),
      ) as unknown as DriveAPIOperations["createFolder"],
    );
    const { onConfirm } = renderMove(operations);
    await screen.findByText("Reports");

    fireEvent.click(newFolderButton());
    fireEvent.change(nameField(), { target: { value: "Invoices" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });

    const confirm = screen.getByRole("button", { name: driveLabels.moveDialogConfirm });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => finish());
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  });

  it("is off when the picker opens inside a folder the viewer cannot add to", async () => {
    renderMove(fakeOperations().operations, vi.fn(), vi.fn(), "My Drive/Archive");

    await waitFor(() => expect((newFolderButton() as HTMLButtonElement).disabled).toBe(true));
    await waitFor(() =>
      expect(newFolderButton().closest("span")?.getAttribute("title")).toBe(
        driveLabels.pickerNewFolderReadOnly,
      ),
    );
  });

  it("keeps the new folder selected when the files list refreshes", async () => {
    const { DriveFolderPicker } = await import("@/drive-core/src/drive-folder-picker");
    const { DrivePickerNewFolderButton } = await import("@/drive-core/src/drive-picker-new-folder");
    const { operations } = fakeOperations();
    const onDestinationChange = vi.fn();
    function Harness({ files }: { files: never[] }) {
      const [control, setControl] = useState<DrivePickerNewFolderControl | null>(null);
      return (
        <TooltipProvider delayDuration={0}>
          <DriveFolderPicker
            labels={driveLabels}
            files={files}
            groupPaths={[]}
            moveIds={[]}
            initialBrowsePath="My Drive"
            operations={operations}
            currentUsername="alice"
            groupRootNames={NO_GROUPS}
            onDestinationChange={onDestinationChange}
            onNewFolderChange={setControl}
          />
          <DrivePickerNewFolderButton labels={driveLabels} control={control} />
        </TooltipProvider>
      );
    }
    const view = render(<Harness files={[]} />);
    await screen.findByText("Reports");
    fireEvent.click(newFolderButton());
    fireEvent.change(nameField(), { target: { value: "Invoices" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });
    await screen.findByText("Invoices");

    // Docs refreshes its list when a folder is created: a new array, same content.
    view.rerender(<Harness files={[]} />);

    expect(onDestinationChange).toHaveBeenLastCalledWith("My Drive/Invoices");
  });

  it("keeps the folder when the dialog is cancelled", async () => {
    const { operations, create } = fakeOperations();
    const { onClose } = renderMove(operations);
    await screen.findByText("Reports");

    fireEvent.click(newFolderButton());
    fireEvent.keyDown(nameField(), { key: "Enter" });
    expect(create).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: driveLabels.moveDialogCancel }));
    expect(onClose).toHaveBeenCalled();
    // Nothing undoes the create: it was made the moment it was named.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("drops the row on Escape without closing the dialog or creating anything", async () => {
    const { operations, create } = fakeOperations();
    const { onClose } = renderMove(operations);
    await screen.findByText("Reports");

    fireEvent.click(newFolderButton());
    fireEvent.keyDown(nameField(), { key: "Escape" });

    expect(screen.queryByLabelText(driveLabels.pickerNewFolderNameLabel)).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a name already used and a name with a slash, inline", async () => {
    const { operations, create } = fakeOperations();
    renderMove(operations);
    await screen.findByText("Reports");

    fireEvent.click(newFolderButton());
    fireEvent.change(nameField(), { target: { value: "reports" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe(
      driveLabels.pickerNewFolderExists("reports"),
    );

    fireEvent.change(nameField(), { target: { value: "a/b" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe(driveLabels.pickerNewFolderInvalid);
    expect(create).not.toHaveBeenCalled();
  });

  it("takes the folder back out and says so when the create fails", async () => {
    const { operations } = fakeOperations(vi.fn().mockRejectedValue(new Error("nope")));
    renderMove(operations);
    await screen.findByText("Reports");

    fireEvent.click(newFolderButton());
    fireEvent.change(nameField(), { target: { value: "Doomed" } });
    await act(async () => {
      fireEvent.keyDown(nameField(), { key: "Enter" });
    });

    await waitFor(() => expect(screen.queryByText("Doomed")).toBeNull());
    expect((await screen.findByRole("alert")).textContent).toBe(driveLabels.pickerNewFolderFailed);
  });

  it("is off, with the reason, in a folder the viewer cannot add to", async () => {
    renderMove(fakeOperations().operations);
    fireEvent.doubleClick(await screen.findByText("Archive"));

    await waitFor(() =>
      expect(newFolderButton().closest("span")?.getAttribute("title")).toBe(
        driveLabels.pickerNewFolderReadOnly,
      ),
    );
    expect((newFolderButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("is off above the drives, where no folder is open", async () => {
    const { DriveFolderPicker } = await import("@/drive-core/src/drive-folder-picker");
    const { DrivePickerNewFolderButton } = await import("@/drive-core/src/drive-picker-new-folder");
    function Harness() {
      const [control, setControl] = useState<DrivePickerNewFolderControl | null>(null);
      return (
        <TooltipProvider delayDuration={0}>
          <DriveFolderPicker
            labels={driveLabels}
            files={[]}
            groupPaths={[]}
            moveIds={[]}
            initialBrowsePath={DRIVE_FOLDER_PICKER_ROOT}
            currentUsername="alice"
            groupRootNames={NO_GROUPS}
            onNewFolderChange={setControl}
          />
          <DrivePickerNewFolderButton labels={driveLabels} control={control} />
        </TooltipProvider>
      );
    }
    render(<Harness />);
    await waitFor(() => expect((newFolderButton() as HTMLButtonElement).disabled).toBe(true));
    expect(newFolderButton().closest("span")?.getAttribute("title")).toBe(
      driveLabels.pickerNewFolderOpenFolder,
    );
  });

  it("is not offered when the picker chooses a file", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <DriveMoveToDialog
          open
          mode="file-select"
          labels={driveLabels}
          files={[]}
          groupPaths={[]}
          view={{ type: "folder", path: "My Drive" }}
          currentUsername="alice"
          groupRootNames={NO_GROUPS}
          onClose={vi.fn()}
          onSelectFile={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: driveLabels.pickerNewFolder })).toBeNull();
  });
});

describe("new folder names", () => {
  const siblings = [optimisticDriveFolder("New folder", "My Drive")];

  it("suggests the next free name", () => {
    expect(suggestDrivePickerFolderName("New folder", [])).toBe("New folder");
    expect(suggestDrivePickerFolderName("New folder", siblings)).toBe("New folder 2");
  });

  it("treats an empty name as not named yet", () => {
    expect(drivePickerFolderNameError("  ", siblings, driveLabels)).toBeNull();
    expect(drivePickerFolderNameError("..", siblings, driveLabels)).toBe(
      driveLabels.pickerNewFolderInvalid,
    );
  });
});
