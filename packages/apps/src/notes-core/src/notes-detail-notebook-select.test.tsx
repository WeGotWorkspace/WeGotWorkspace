import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Note } from "@/lib/models/note";
import { NotesDetailNotebookSelect } from "@/notes-core/src/notes-detail-notebook-select";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookSelectItem } from "@/notes-core/src/notes-notebook-select";

afterEach(() => {
  cleanup();
});

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

const notebooks: NotesNotebookSelectItem[] = [
  { id: "Drafts", name: "Drafts", color: "#f59e0b" },
  { id: "The Journal", name: "The Journal", color: "#14b8a6" },
];

const owned: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "Hello",
  body: ["Hello"],
  notebook: "Drafts",
  tags: [],
  wordCount: 1,
};

const shared: Note = {
  ...owned,
  id: "swm-1",
  notebook: "TeamPad",
  sharedInbox: true,
  sharedBy: "bob",
  apiPath: "/users/bob/.notes/TeamPad/swm-1.md",
};

function renderSelect(props: Partial<ComponentProps<typeof NotesDetailNotebookSelect>> = {}) {
  return render(
    <NotesDetailNotebookSelect
      active={owned}
      labels={defaultNotesLabels}
      archived={{}}
      notebooks={notebooks}
      onMoveToNotebook={vi.fn()}
      {...props}
    />,
  );
}

describe("NotesDetailNotebookSelect", () => {
  it("shows the notebook name in its colour as a ghost dropdown", () => {
    renderSelect({ notebookColor: "#f59e0b" });
    const move = screen.getByRole("combobox", { name: "Drafts" });
    expect(move.className).toContain("notes-notebook-select--ghost");
    expect(move.textContent).toBe("Drafts");
    expect(move.style.getPropertyValue("--collection-row-color")).toBe("#f59e0b");
    expect(move.querySelector(".collection-ghost-select__chevron")).toBeTruthy();
    expect(move.hasAttribute("disabled")).toBe(false);
  });

  it("opens Create notebook from the picker", () => {
    stubSelectEnv();
    const onCreateNotebook = vi.fn();
    const onMoveToNotebook = vi.fn();
    renderSelect({ onCreateNotebook, onMoveToNotebook });
    fireEvent.click(screen.getByRole("combobox", { name: "Drafts" }));
    fireEvent.click(screen.getByRole("option", { name: defaultNotesLabels.addNotebook }));
    expect(onCreateNotebook).toHaveBeenCalledTimes(1);
    expect(onMoveToNotebook).not.toHaveBeenCalled();
  });

  it("shows the live collection name when the note still has the old name", () => {
    renderSelect({
      active: { ...owned, notebook: "Drafts", notebookId: "Drafts" },
      notebooks: [{ id: "Drafts", name: "Journal", color: "#f59e0b" }],
    });
    expect(screen.getByRole("combobox", { name: "Journal" })).toBeTruthy();
  });

  it("is locked for shared-inbox notes and never shows the grantor", () => {
    const onMoveToNotebook = vi.fn();
    const onCreateNotebook = vi.fn();
    renderSelect({ active: shared, onMoveToNotebook, onCreateNotebook });
    const move = screen.getByRole("combobox", { name: "TeamPad" });
    expect(move.textContent).not.toContain("bob");
    expect(move.hasAttribute("disabled")).toBe(true);
    // Locked keeps the chevron, dimmed: the notebook still reads as a choice.
    expect(move.querySelector(".collection-ghost-select__chevron")).toBeTruthy();
    fireEvent.click(move);
    expect(onMoveToNotebook).not.toHaveBeenCalled();
    expect(onCreateNotebook).not.toHaveBeenCalled();
  });

  it("is locked for a view-only share and for an archived note", () => {
    renderSelect({ readOnly: true });
    expect(screen.getByRole("combobox", { name: "Drafts" }).hasAttribute("disabled")).toBe(true);
    cleanup();
    renderSelect({ archived: { "n-1": true } });
    expect(screen.getByRole("combobox", { name: "Drafts" }).hasAttribute("disabled")).toBe(true);
  });

  it("moves a writable group notebook note", () => {
    stubSelectEnv();
    const onMoveToNotebook = vi.fn();
    renderSelect({
      active: {
        ...owned,
        id: "g-1",
        notebook: "Specs",
        notebookId: "group-eng",
        scope: "group",
        groupSlug: "eng",
      },
      notebooks: [{ id: "group-eng", name: "Specs", color: "#0ea5e9" }, ...notebooks],
      onMoveToNotebook,
      onCreateNotebook: vi.fn(),
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Specs" }));
    fireEvent.click(screen.getByRole("option", { name: "The Journal" }));
    expect(onMoveToNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "The Journal", name: "The Journal" }),
    );
  });

  it("shows the group collection display name, not the group-… slug", () => {
    renderSelect({
      active: {
        ...owned,
        notebook: "group-administrators",
        notebookId: "group-administrators",
        scope: "group",
        groupSlug: "administrators",
      },
      notebooks: [{ id: "group-administrators", name: "Administratorss", color: "#ea8c72" }],
    });
    const move = screen.getByRole("combobox", { name: "Administratorss" });
    expect(move.textContent).toBe("Administratorss");
    expect(move.style.getPropertyValue("--collection-row-color")).toBe("#ea8c72");
  });
});
