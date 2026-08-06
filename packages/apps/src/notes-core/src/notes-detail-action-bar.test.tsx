import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Note } from "@/lib/models/note";
import { NotesDetailActionBar } from "@/notes-core/src/notes-detail-action-bar";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { TooltipProvider } from "@/ui/tooltip";

function renderBar(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

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

describe("NotesDetailActionBar", () => {
  it("shows notebook name and keeps move enabled for owned notes", () => {
    const openMoveDialog = vi.fn();
    renderBar(
      <NotesDetailActionBar
        active={owned}
        labels={defaultNotesLabels}
        archived={{}}
        starred={{}}
        closeMobileDetail={() => {}}
        openMoveDialog={openMoveDialog}
        toggleStar={() => {}}
        toggleArchive={() => {}}
      />,
    );

    const move = screen.getByRole("button", { name: defaultNotesLabels.toolbarMoveToNotebook });
    expect(move.textContent).toContain("Drafts");
    expect(move.hasAttribute("disabled")).toBe(false);
    move.click();
    expect(openMoveDialog).toHaveBeenCalledWith(["n-1"]);
  });

  it("shows Shared by and disables notebook switch for shared-inbox notes", () => {
    const openMoveDialog = vi.fn();
    renderBar(
      <NotesDetailActionBar
        active={shared}
        labels={defaultNotesLabels}
        archived={{}}
        starred={{}}
        closeMobileDetail={() => {}}
        openMoveDialog={openMoveDialog}
        toggleStar={() => {}}
        toggleArchive={() => {}}
      />,
    );

    const move = screen.getByRole("button", { name: "Shared by bob" });
    expect(move.textContent).toContain("Shared by bob");
    expect(move.hasAttribute("disabled")).toBe(true);
    move.click();
    expect(openMoveDialog).not.toHaveBeenCalled();
  });

  it("disables star and archive when readOnly (view-only share)", () => {
    const toggleStar = vi.fn();
    const toggleArchive = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={owned}
        labels={defaultNotesLabels}
        archived={{}}
        starred={{}}
        closeMobileDetail={() => {}}
        openMoveDialog={vi.fn()}
        toggleStar={toggleStar}
        toggleArchive={toggleArchive}
        readOnly
      />,
    );

    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();
    const star = row!.querySelector('button[aria-label="Star"]');
    const archive = row!.querySelector('button[aria-label="Archive"]');
    expect(star?.hasAttribute("disabled")).toBe(true);
    expect(archive?.hasAttribute("disabled")).toBe(true);
    star?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    archive?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggleStar).not.toHaveBeenCalled();
    expect(toggleArchive).not.toHaveBeenCalled();
  });

  it("omits star for personal shared-with-me notes", () => {
    const { container } = renderBar(
      <NotesDetailActionBar
        active={shared}
        labels={defaultNotesLabels}
        archived={{}}
        starred={{}}
        closeMobileDetail={() => {}}
        openMoveDialog={vi.fn()}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    expect(row!.querySelector('button[aria-label="Star"]')).toBeNull();
    expect(row!.querySelector('button[aria-label="Archive"]')).toBeTruthy();
  });

  it("keeps star for group notebook notes", () => {
    const group: Note = {
      ...owned,
      id: "g-1",
      scope: "group",
      groupSlug: "eng",
    };
    const { container } = renderBar(
      <NotesDetailActionBar
        active={group}
        labels={defaultNotesLabels}
        archived={{}}
        starred={{}}
        closeMobileDetail={() => {}}
        openMoveDialog={vi.fn()}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    expect(container.querySelector('button[aria-label="Star"]')).toBeTruthy();
  });
});
