import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesNewMenu } from "@/notes-core/src/notes-new-menu";

const L = defaultNotesLabels;

describe("NotesNewMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  it("creates a note from the main control without opening a menu", () => {
    const onCreateNote = vi.fn();
    render(
      <NotesNewMenu labels={L} onCreateNote={onCreateNote} onCreateNotebook={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: L.newNote }));

    expect(onCreateNote).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: L.addNotebook })).toBeNull();
  });

  it("opens create notebook from the chevron", () => {
    const onCreateNotebook = vi.fn();
    render(
      <NotesNewMenu labels={L} onCreateNote={vi.fn()} onCreateNotebook={onCreateNotebook} />,
    );

    const chevron = screen.getByRole("button", { name: L.newNoteMenu });
    fireEvent.pointerDown(chevron);
    fireEvent.click(chevron);
    fireEvent.click(screen.getByRole("button", { name: L.addNotebook }));
    expect(onCreateNotebook).toHaveBeenCalledOnce();
  });

  it("hides the chevron when notebook create is unavailable", () => {
    render(<NotesNewMenu labels={L} onCreateNote={vi.fn()} />);

    const main = screen.getByRole("button", { name: L.newNote });
    expect(main).toBeTruthy();
    expect(main.className).toMatch(/sidebar-segmented-new-menu__main--solo/);
    expect(screen.queryByRole("button", { name: L.newNoteMenu })).toBeNull();
  });
});
