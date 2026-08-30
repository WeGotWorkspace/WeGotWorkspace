import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTES_CREATE_NOTEBOOK_VALUE,
  NotesNotebookSelect,
  notebookSelectValueForNotes,
  notebookSelectionEquals,
  notebooksWithCurrent,
  pendingMoveAfterNotebookCreate,
  resolveNotebookSelectValue,
} from "@/notes-core/src/notes-notebook-select";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";

const notebooks = [
  { id: "nb-journal", name: "The Journal", color: "#14b8a6" },
  { id: "nb-drafts", name: "Drafts", color: "#f59e0b" },
  { id: "nb-field", name: "Field Observations", color: "#0ea5e9" },
];

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

describe("NotesNotebookSelect helpers", () => {
  it("keeps the current notebook in the menu when it is missing from the list", () => {
    expect(
      notebooksWithCurrent(notebooks, { id: "shared", name: "TeamPad", color: "#8b5cf6" }).map(
        (item) => item.name,
      ),
    ).toEqual(["TeamPad", "The Journal", "Drafts", "Field Observations"]);
  });

  it("resolves the selected value to the matching collection id", () => {
    expect(resolveNotebookSelectValue(notebooks, { name: "Drafts" })).toBe("nb-drafts");
  });

  it("resolves the picker value from the first selected note", () => {
    expect(
      notebookSelectValueForNotes(
        [
          { id: "n-1", notebook: "Drafts", notebookId: "nb-drafts" },
          { id: "n-2", notebook: "The Journal", notebookId: "nb-journal" },
        ],
        ["n-1", "n-2"],
        notebooks,
      ),
    ).toEqual({ id: "nb-drafts", name: "Drafts", color: "#f59e0b" });
    expect(notebookSelectValueForNotes([], undefined, notebooks)).toEqual({ name: "" });
  });

  it("resolves a group collection display name when the note still stores the collection id", () => {
    const groupNotebooks = [
      { id: "group-administrators", name: "Administratorss", color: "#ea8c72" },
    ];
    expect(
      notebookSelectValueForNotes(
        [{ id: "n-1", notebook: "group-administrators", notebookId: "group-administrators" }],
        ["n-1"],
        groupNotebooks,
      ),
    ).toEqual({ id: "group-administrators", name: "Administratorss", color: "#ea8c72" });
    expect(
      notebooksWithCurrent(groupNotebooks, {
        id: "group-administrators",
        name: "group-administrators",
      }).map((item) => item.name),
    ).toEqual(["Administratorss"]);
    expect(
      resolveNotebookSelectValue(groupNotebooks, {
        id: "group-administrators",
        name: "group-administrators",
      }),
    ).toBe("group-administrators");
  });

  it("compares notebook identity by id when both sides have one", () => {
    expect(
      notebookSelectionEquals(
        { id: "nb-drafts", name: "Drafts" },
        { id: "nb-drafts", name: "Renamed" },
      ),
    ).toBe(true);
    expect(
      notebookSelectionEquals(
        { id: "nb-drafts", name: "Drafts" },
        { id: "nb-journal", name: "The Journal" },
      ),
    ).toBe(false);
    expect(notebookSelectionEquals({ name: "Drafts" }, { name: "Drafts" })).toBe(true);
  });

  it("does not move until a created notebook exists", () => {
    expect(pendingMoveAfterNotebookCreate(undefined, ["n-1"])).toBeNull();
    expect(pendingMoveAfterNotebookCreate({ name: "Ideas" }, null)).toBeNull();
    expect(pendingMoveAfterNotebookCreate({ name: "Ideas" }, ["n-1"])).toEqual({
      ids: ["n-1"],
      notebook: "Ideas",
    });
  });
});

describe("NotesNotebookSelect", () => {
  beforeEach(stubSelectEnv);
  afterEach(() => {
    cleanup();
  });

  it("lists notebooks with colored notebook icons, the current notebook selected, and Create after a separator", () => {
    const onNotebookChange = vi.fn();
    const onCreateNotebook = vi.fn();
    const { container } = render(
      <NotesNotebookSelect
        notebooks={notebooks}
        value={{ id: "nb-drafts", name: "Drafts", color: "#f59e0b" }}
        labels={defaultNotesLabels}
        onNotebookChange={onNotebookChange}
        onCreateNotebook={onCreateNotebook}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook });
    expect(trigger.textContent).toContain("Drafts");
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "The Journal",
      "Drafts",
      "Field Observations",
      defaultNotesLabels.addNotebook,
    ]);
    expect(document.querySelector(".notes-notebook-select__separator")).toBeTruthy();
    expect(container.querySelectorAll(".notes-notebook-color-icon")).toHaveLength(1);
    expect(document.querySelectorAll('[role="listbox"] .notes-notebook-color-icon')).toHaveLength(3);
    expect(document.querySelector(".collection-sidebar-row__dot")).toBeNull();
    expect(screen.getByRole("option", { name: "Drafts" }).getAttribute("data-state")).toBe(
      "checked",
    );

    fireEvent.click(screen.getByRole("option", { name: defaultNotesLabels.addNotebook }));
    expect(onCreateNotebook).toHaveBeenCalledTimes(1);
    expect(onNotebookChange).not.toHaveBeenCalled();
    expect(NOTES_CREATE_NOTEBOOK_VALUE).toBe("__create_notebook__");
  });

  it("moves when choosing another notebook", () => {
    const onNotebookChange = vi.fn();
    render(
      <NotesNotebookSelect
        notebooks={notebooks}
        value={{ id: "nb-drafts", name: "Drafts" }}
        labels={defaultNotesLabels}
        onNotebookChange={onNotebookChange}
        onCreateNotebook={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }));
    fireEvent.click(screen.getByRole("option", { name: "The Journal" }));
    expect(onNotebookChange).toHaveBeenCalledWith(notebooks[0]);
  });
});
