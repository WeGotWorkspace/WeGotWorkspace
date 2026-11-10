import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Note } from "@/lib/models/note";
import { NotesDetailActionBar } from "@/notes-core/src/notes-detail-action-bar";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { TooltipProvider } from "@/ui/tooltip";

afterEach(() => {
  cleanup();
});

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

const barProps = {
  labels: defaultNotesLabels,
  archived: {},
  starred: {},
  closeMobileDetail: () => {},
  toggleStar: () => {},
  toggleArchive: () => {},
};

describe("NotesDetailActionBar", () => {
  it("has no notebook switcher (it sits above the title)", () => {
    const { container } = renderBar(<NotesDetailActionBar active={owned} {...barProps} />);
    expect(container.querySelector(".notes-notebook-select")).toBeNull();
  });

  it("renders nothing when no note is active", () => {
    const { container } = renderBar(<NotesDetailActionBar active={undefined} {...barProps} />);
    expect(container.querySelector(".action-bar")).toBeNull();
  });

  it("shows the list name on the mobile back control", () => {
    renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        backLabel="All Items"
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    const back = screen.getByRole("button", { name: "All Items" });
    expect(back.textContent).toContain("All Items");
    expect(back.className).toContain("action-bar__back");
    expect(back.className).toContain("button--variant-outline");
  });

  it("keeps star enabled and disables archive for a view-only share", () => {
    const toggleStar = vi.fn();
    const toggleArchive = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        toggleStar={toggleStar}
        toggleArchive={toggleArchive}
        canArchive={false}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    expect(row).toBeTruthy();
    const star = row!.querySelector('button[aria-label="Star"]');
    const archive = row!.querySelector('button[aria-label="Archive"]');
    expect(star?.hasAttribute("disabled")).toBe(false);
    expect(archive?.hasAttribute("disabled")).toBe(true);
    star?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    archive?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggleStar).toHaveBeenCalledWith("n-1");
    expect(toggleArchive).not.toHaveBeenCalled();
  });

  it("disables archive for personal shared notes", () => {
    const toggleArchive = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={shared}
        {...barProps}
        toggleStar={vi.fn()}
        toggleArchive={toggleArchive}
        canArchive={false}
      />,
    );

    const archive = container.querySelector('button[aria-label="Archive"]');
    expect(archive?.hasAttribute("disabled")).toBe(true);
    archive?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggleArchive).not.toHaveBeenCalled();
  });

  it("keeps archive enabled for owned notes", () => {
    const toggleArchive = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        toggleStar={vi.fn()}
        toggleArchive={toggleArchive}
        canArchive
      />,
    );

    const archive = container.querySelector('button[aria-label="Archive"]');
    expect(archive?.hasAttribute("disabled")).toBe(false);
    archive?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggleArchive).toHaveBeenCalledWith("n-1");
  });

  it("shows star for personal shared-with-me notes", () => {
    const toggleStar = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={shared}
        {...barProps}
        toggleStar={toggleStar}
        toggleArchive={vi.fn()}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    const star = row!.querySelector('button[aria-label="Star"]');
    expect(star).toBeTruthy();
    star?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggleStar).toHaveBeenCalledWith(shared.id);
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
        {...barProps}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    expect(container.querySelector('button[aria-label="Star"]')).toBeTruthy();
  });

  it("marks Star and Archive as pressed when the note is starred or archived", () => {
    const { container } = renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        starred={{ "n-1": true }}
        archived={{ "n-1": true }}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    const star = row!.querySelector('button[aria-label="Star"]');
    const archive = row!.querySelector('button[aria-label="Unarchive"]');
    expect(star?.className).toContain("icon-button--active");
    expect(archive?.className).toContain("icon-button--active");
  });

  it("keeps idle Star and Archive without the selected class", () => {
    const { container } = renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    const star = row!.querySelector('button[aria-label="Star"]');
    const archive = row!.querySelector('button[aria-label="Archive"]');
    expect(star?.className).not.toContain("icon-button--active");
    expect(archive?.className).not.toContain("icon-button--active");
  });
});
