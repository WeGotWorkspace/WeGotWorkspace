import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesChangeNotebookDialog } from "@/notes-core/src/notes-change-notebook-dialog";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";

const notebooks = [
  { id: "nb-journal", name: "The Journal", color: "#14b8a6" },
  { id: "nb-drafts", name: "Drafts", color: "#f59e0b" },
  { id: "nb-field", name: "Field Observations", color: "#0ea5e9" },
];

const createdNotebook = { id: "nb-ideas", name: "Ideas", color: "#8b5cf6" };

function stubSelectEnv() {
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderDialog(
  overrides: Partial<ComponentProps<typeof NotesChangeNotebookDialog>> = {},
) {
  const onNotebookChange = vi.fn();
  const onCreateNotebook = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <NotesChangeNotebookDialog
      open
      notebooks={notebooks}
      value={{ id: "nb-drafts", name: "Drafts", color: "#f59e0b" }}
      labels={defaultNotesLabels}
      onClose={onClose}
      onNotebookChange={onNotebookChange}
      onCreateNotebook={onCreateNotebook}
      {...overrides}
    />,
  );
  return { onNotebookChange, onCreateNotebook, onClose, ...view };
}

describe("NotesChangeNotebookDialog", () => {
  beforeEach(stubSelectEnv);
  afterEach(() => {
    cleanup();
  });

  it("lists the shared picker items, colors, current notebook, and Create notebook", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: defaultNotesLabels.selectionMoveToNotebook })).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Change" });
    expect(confirm.textContent).toBe("Change");
    expect(confirm.getAttribute("aria-label")).toBe("Change");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const trigger = screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook });
    expect(trigger.className).toContain("notes-notebook-select");
    expect(trigger.textContent).toContain("Drafts");
    expect(trigger.querySelectorAll(".notes-notebook-color-icon")).toHaveLength(1);
    expect(trigger.querySelector(".collection-sidebar-row__dot")).toBeNull();
    fireEvent.click(trigger);

    expect(screen.getAllByRole("option").map((option) => option.textContent?.trim())).toEqual([
      "The Journal",
      "Drafts",
      "Field Observations",
      defaultNotesLabels.addNotebook,
    ]);
    expect(document.querySelector(".notes-notebook-select__separator")).toBeTruthy();
    expect(document.querySelectorAll('[role="listbox"] .notes-notebook-color-icon')).toHaveLength(3);
    expect(document.querySelector('[role="listbox"] .collection-sidebar-row__dot')).toBeNull();
    expect(screen.getByRole("option", { name: "Drafts" }).getAttribute("data-state")).toBe(
      "checked",
    );
  });

  it("names the confirm control Change with visible text", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: "Change" });
    expect(confirm.textContent).toBe("Change");
    expect(confirm.getAttribute("aria-label")).toBe("Change");
    expect(confirm.querySelector("svg")).toBeNull();
  });

  it("keeps the dialog open and does not move until Change", () => {
    const { onNotebookChange, onClose } = renderDialog();

    fireEvent.click(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }));
    fireEvent.click(screen.getByRole("option", { name: "The Journal" }));
    expect(onNotebookChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }).textContent).toContain(
      "The Journal",
    );

    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.changeNotebookConfirm }));
    expect(onNotebookChange).toHaveBeenCalledWith(notebooks[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not move when Cancel closes a dirty draft", () => {
    const { onNotebookChange, onClose } = renderDialog();

    fireEvent.click(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }));
    fireEvent.click(screen.getByRole("option", { name: "The Journal" }));
    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.dialogCancel }));
    expect(onNotebookChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens Create notebook without moving or closing, then Change moves the created draft", () => {
    const { onNotebookChange, onCreateNotebook, onClose, rerender } = renderDialog();

    fireEvent.click(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }));
    fireEvent.click(screen.getByRole("option", { name: defaultNotesLabels.addNotebook }));
    expect(onCreateNotebook).toHaveBeenCalledTimes(1);
    expect(onNotebookChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    rerender(
      <NotesChangeNotebookDialog
        open
        notebooks={[...notebooks, createdNotebook]}
        value={{ id: "nb-drafts", name: "Drafts", color: "#f59e0b" }}
        createdNotebook={createdNotebook}
        labels={defaultNotesLabels}
        onClose={onClose}
        onNotebookChange={onNotebookChange}
        onCreateNotebook={onCreateNotebook}
      />,
    );

    expect(onNotebookChange).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }).textContent).toContain(
      "Ideas",
    );
    fireEvent.click(screen.getByRole("button", { name: defaultNotesLabels.changeNotebookConfirm }));
    expect(onNotebookChange).toHaveBeenCalledWith(createdNotebook);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
