import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import {
  NotesImportDialog,
  type NotesImportDialogProps,
} from "@/notes-core/src/notes-import-dialog";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";

const L = defaultNotesLabels;
const files = [new File(["# A"], "a.md"), new File(["# B"], "b.md")];
const notebooks: NotesNotebookCollection[] = [
  { id: "general", name: "General", isDefault: true },
  { id: "work", name: "Work" },
];

function renderDialog(props: Partial<NotesImportDialogProps> = {}) {
  const onImport = vi.fn();
  const onClose = vi.fn();
  render(
    <TooltipProvider>
      <NotesImportDialog
        open
        files={files}
        notebooks={notebooks}
        labels={L}
        onImport={onImport}
        onClose={onClose}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onImport, onClose };
}

describe("NotesImportDialog", () => {
  afterEach(() => cleanup());

  it("imports into the notebook of the current view", () => {
    const { onImport } = renderDialog({ defaultNotebookId: "work" });
    expect(screen.getByText(L.importFilesSelected(2))).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: L.importSubmit }));
    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));
    expect(onImport).toHaveBeenCalledWith(files, { mode: "existing", notebook: notebooks[1] });
  });

  it("falls back to the default notebook when the view is not writable", () => {
    const { onImport } = renderDialog({ defaultNotebookId: "shared-read-only" });
    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));
    expect(onImport).toHaveBeenCalledWith(files, { mode: "existing", notebook: notebooks[0] });
  });

  it("asks for a new notebook name when there is no writable notebook", () => {
    const { onImport } = renderDialog({ notebooks: [] });
    const name = screen.getByLabelText(L.importNewNotebookName) as HTMLInputElement;
    expect(name.value).toBe(L.importNewNotebookDefault);
    fireEvent.change(name, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: L.importSubmit })).toHaveProperty("disabled", true);
    fireEvent.change(name, { target: { value: "Obsidian " } });
    fireEvent.click(screen.getByRole("button", { name: L.importSubmit }));
    expect(onImport).toHaveBeenCalledWith(files, { mode: "create", name: "Obsidian" });
  });

  it("shows progress and blocks closing while busy", () => {
    const { onClose } = renderDialog({ busy: true, progress: { done: 1, total: 2 } });
    expect(screen.getAllByText(L.importProgress(1, 2)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: L.dialogCancel })).toHaveProperty("disabled", true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the result with skipped files, dropped tags and images", () => {
    const { onClose } = renderDialog({
      result: {
        imported: [{ id: "n1" } as never],
        skipped: [
          { fileName: "empty.md", reason: "empty" },
          { fileName: "ro.md", reason: "failed", status: 403 },
        ],
        droppedTags: ["2024"],
        imagesNotImported: 2,
      },
    });
    expect(screen.getByText(L.importedNotes(1))).toBeTruthy();
    expect(screen.getByText("empty.md")).toBeTruthy();
    expect(screen.getByText(L.importSkipReason("empty"))).toBeTruthy();
    expect(screen.getByText(L.importSkipReason("failed", 403))).toBeTruthy();
    expect(screen.getByText(L.importDroppedTags(["2024"]))).toBeTruthy();
    expect(screen.getByText(L.importImagesNotImported(2))).toBeTruthy();
    expect(screen.queryByRole("button", { name: L.importSubmit })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: L.importDone }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
