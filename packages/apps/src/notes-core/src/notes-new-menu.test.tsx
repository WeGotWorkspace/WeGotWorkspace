import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesNewMenu } from "@/notes-core/src/notes-new-menu";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceCss = readFileSync(join(here, "notes-workspace.css"), "utf8");

const L = defaultNotesLabels;

describe("NotesNewMenu", () => {
  beforeEach(() => {
    cleanup();
  });

  it("creates a note from the main control without opening a menu", () => {
    const onCreateNote = vi.fn();
    render(<NotesNewMenu labels={L} onCreateNote={onCreateNote} onCreateNotebook={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: L.newNote }));

    expect(onCreateNote).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: L.addNotebook })).toBeNull();
  });

  it("opens create notebook from the chevron", () => {
    const onCreateNotebook = vi.fn();
    render(<NotesNewMenu labels={L} onCreateNote={vi.fn()} onCreateNotebook={onCreateNotebook} />);

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

  it("keeps New note enabled unless disabled is set", () => {
    render(<NotesNewMenu labels={L} onCreateNote={vi.fn()} />);
    const main = screen.getByRole("button", { name: L.newNote });
    expect(main).toHaveProperty("disabled", false);
    expect(main.getAttribute("aria-label")).toBe(L.newNote);
  });

  it("disables New note only when disabled is set", () => {
    render(<NotesNewMenu labels={L} onCreateNote={vi.fn()} disabled />);
    const main = screen.getByRole("button", { name: L.newNote });
    expect(main).toHaveProperty("disabled", true);
    expect(main.getAttribute("aria-label")).toBe(L.newNote);
  });
});

describe("NotesNewMenu primary tokens", () => {
  it("paints sidebar New note gold fill + ink label (invert of selected chips)", () => {
    expect(workspaceCss).toMatch(
      /\.notes-workspace \.app-sidebar__scroll \{[^}]*--button-primary-bg:\s*var\(--notes-accent\)/,
    );
    expect(workspaceCss).toMatch(
      /\.notes-workspace \.app-sidebar__scroll \{[^}]*--button-primary-fg:\s*var\(--color-ink(?:,\s*#042a22)?\)/,
    );
    expect(workspaceCss).not.toMatch(
      /\.notes-workspace \.app-sidebar__scroll \{[^}]*--button-primary-bg:\s*var\(--color-ink/,
    );
  });
});
