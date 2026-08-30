import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Note } from "@/lib/models/note";
import { NotesDetailActionBar } from "@/notes-core/src/notes-detail-action-bar";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookSelectItem } from "@/notes-core/src/notes-notebook-select";
import { TooltipProvider } from "@/ui/tooltip";

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

function renderBar(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
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

const barProps = {
  labels: defaultNotesLabels,
  archived: {},
  starred: {},
  closeMobileDetail: () => {},
  notebooks,
  onMoveToNotebook: vi.fn(),
  toggleStar: () => {},
  toggleArchive: () => {},
};

describe("NotesDetailActionBar", () => {
  it("renders nothing when no note is active", () => {
    const { container } = renderBar(
      <NotesDetailActionBar active={undefined} {...barProps} />,
    );
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
  });

  it("opens Create notebook from the shared picker", () => {
    stubSelectEnv();
    const onCreateNotebook = vi.fn();
    const onMoveToNotebook = vi.fn();
    renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        onMoveToNotebook={onMoveToNotebook}
        onCreateNotebook={onCreateNotebook}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook }));
    fireEvent.click(screen.getByRole("option", { name: defaultNotesLabels.addNotebook }));
    expect(onCreateNotebook).toHaveBeenCalledTimes(1);
    expect(onMoveToNotebook).not.toHaveBeenCalled();
  });

  it("shows a notebook dropdown for owned notes", () => {
    renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        onMoveToNotebook={vi.fn()}
        onCreateNotebook={vi.fn()}
      />,
    );

    const move = screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook });
    expect(move.textContent).toContain("Drafts");
    expect(move.hasAttribute("disabled")).toBe(false);
    expect(move.className).toContain("notes-notebook-select");
    expect(move.className).toContain("select-trigger--size-sm");
  });

  it("shows the live collection name when the note still has the old name", () => {
    renderBar(
      <NotesDetailActionBar
        active={{ ...owned, notebook: "Drafts", notebookId: "Drafts" }}
        {...barProps}
        notebooks={[{ id: "Drafts", name: "Journal", color: "#f59e0b" }]}
      />,
    );

    const move = screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook });
    expect(move.textContent).toContain("Journal");
    expect(move.textContent).not.toContain("Drafts");
  });

  it("disables notebook switch for shared-inbox notes without a username chip", () => {
    const onMoveToNotebook = vi.fn();
    const onCreateNotebook = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={shared}
        {...barProps}
        onMoveToNotebook={onMoveToNotebook}
        onCreateNotebook={onCreateNotebook}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    const move = screen.getByRole("combobox", { name: "TeamPad" });
    expect(move.textContent).toContain("TeamPad");
    expect(move.textContent).not.toContain("bob");
    expect(move.textContent).not.toContain("Shared by");
    expect(container.querySelector(".notes-detail-action-bar__shared-by")).toBeNull();
    expect(move.hasAttribute("disabled")).toBe(true);
    fireEvent.click(move);
    expect(onMoveToNotebook).not.toHaveBeenCalled();
    expect(onCreateNotebook).not.toHaveBeenCalled();
  });

  it("disables star and archive when readOnly (view-only share)", () => {
    const toggleStar = vi.fn();
    const toggleArchive = vi.fn();
    const { container } = renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        toggleStar={toggleStar}
        toggleArchive={toggleArchive}
        readOnly
        canArchive={false}
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

  it("omits star for personal shared-with-me notes", () => {
    const { container } = renderBar(
      <NotesDetailActionBar
        active={shared}
        {...barProps}
        toggleStar={vi.fn()}
        toggleArchive={vi.fn()}
      />,
    );

    const row = container.querySelector(".action-bar__row");
    expect(row!.querySelector('button[aria-label="Star"]')).toBeNull();
    expect(row!.querySelector('button[aria-label="Archive"]')).toBeTruthy();
  });

  it("enables notebook switch for writable group notebook notes and moves", () => {
    stubSelectEnv();
    const onMoveToNotebook = vi.fn();
    const group: Note = {
      ...owned,
      id: "g-1",
      notebook: "Specs",
      notebookId: "group-eng",
      scope: "group",
      groupSlug: "eng",
    };
    const groupNotebooks: NotesNotebookSelectItem[] = [
      { id: "group-eng", name: "Specs", color: "#0ea5e9" },
      ...notebooks,
    ];
    renderBar(
      <NotesDetailActionBar
        active={group}
        {...barProps}
        notebooks={groupNotebooks}
        onMoveToNotebook={onMoveToNotebook}
        onCreateNotebook={vi.fn()}
      />,
    );

    const move = screen.getByRole("combobox", { name: defaultNotesLabels.toolbarMoveToNotebook });
    expect(move.textContent).toContain("Specs");
    expect(move.hasAttribute("disabled")).toBe(false);
    fireEvent.click(move);
    fireEvent.click(screen.getByRole("option", { name: "The Journal" }));
    expect(onMoveToNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ id: "The Journal", name: "The Journal" }),
    );
  });

  it("disables notebook switch when readOnly (view-only sharee)", () => {
    const onMoveToNotebook = vi.fn();
    const onCreateNotebook = vi.fn();
    renderBar(
      <NotesDetailActionBar
        active={owned}
        {...barProps}
        onMoveToNotebook={onMoveToNotebook}
        onCreateNotebook={onCreateNotebook}
        readOnly
      />,
    );

    const move = screen.getByRole("combobox", { name: "Drafts" });
    expect(move.hasAttribute("disabled")).toBe(true);
    fireEvent.click(move);
    expect(onMoveToNotebook).not.toHaveBeenCalled();
    expect(onCreateNotebook).not.toHaveBeenCalled();
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
