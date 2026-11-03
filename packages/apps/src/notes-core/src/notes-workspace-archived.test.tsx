import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notesMockAdapter } from "@/lib/adapters/mock/notes-mock-adapter";
import { createNotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirmDialog: null, requestConfirm: vi.fn() }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouterState: (opts?: {
      select?: (state: { location: { pathname: string } }) => unknown;
    }) => {
      const state = { location: { pathname: "/notes/archive/1" } };
      return opts?.select ? opts.select(state) : state;
    },
    useNavigate: () => vi.fn(),
  };
});

function bootstrapWithNoteOne(archived: boolean) {
  const seed = notesMockAdapter.getSeedData();
  return createNotesAppBootstrap({
    data: {
      ...seed,
      notes: seed.notes.map((note) => (note.id === "1" ? { ...note, archived } : note)),
    },
  });
}

function renderOpenNote(archived: boolean) {
  const view = archived ? "archive" : "all";
  render(
    <NotesWorkspace
      {...bootstrapWithNoteOne(archived)}
      listLoading={false}
      initialView={view}
      initialNoteId="1"
    />,
  );
  return screen.getByRole("main");
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      addEventListener: vi.fn(),
      removeListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an archived note in the workspace (#1535)", () => {
  it("opens read-only: no title edit, no tag change, no move", () => {
    const pane = renderOpenNote(true);

    const title = within(pane).getByLabelText(defaultNotesLabels.titlePlaceholder);
    expect(title.hasAttribute("readonly")).toBe(true);
    expect(within(pane).queryByRole("button", { name: "Add tag" })).toBeNull();
    expect(within(pane).queryByRole("button", { name: /^Remove / })).toBeNull();
    const move = within(pane).getByRole("combobox", { name: "The Journal" });
    expect(move.hasAttribute("disabled")).toBe(true);
    for (const editable of pane.querySelectorAll("[contenteditable]")) {
      expect(editable.getAttribute("contenteditable")).toBe("false");
    }
  });

  it("keeps restore and star available", () => {
    const pane = renderOpenNote(true);

    const restore = within(pane).getByRole("button", { name: defaultNotesLabels.toolbarUnarchive });
    expect(restore.hasAttribute("disabled")).toBe(false);
    const star = within(pane).getByRole("button", { name: defaultNotesLabels.toolbarStar });
    expect(star.hasAttribute("disabled")).toBe(false);
  });

  it("leaves an active note editable", () => {
    const pane = renderOpenNote(false);

    const title = within(pane).getByLabelText(defaultNotesLabels.titlePlaceholder);
    expect(title.hasAttribute("readonly")).toBe(false);
    expect(within(pane).getByRole("button", { name: "Add tag" })).toBeTruthy();
    const move = within(pane).getByRole("combobox", { name: "The Journal" });
    expect(move.hasAttribute("disabled")).toBe(false);
  });
});

describe("an archived note under an old URL (#1531)", () => {
  it("lands on the Archived view for that note", async () => {
    const onViewChange = vi.fn();
    render(
      <NotesWorkspace
        {...bootstrapWithNoteOne(true)}
        listLoading={false}
        initialView="all"
        initialNoteId="1"
        onViewChange={onViewChange}
      />,
    );

    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith("archive"));
    const title = within(screen.getByRole("main")).getByLabelText(
      defaultNotesLabels.titlePlaceholder,
    );
    expect(title.hasAttribute("readonly")).toBe(true);
  });

  it("follows an archive from another tab without a reload", async () => {
    const onViewChange = vi.fn();
    const props = { listLoading: false, initialView: "all", initialNoteId: "1", onViewChange };
    const { rerender } = render(
      <NotesWorkspace {...bootstrapWithNoteOne(false)} {...props} bootstrapRevision={1} />,
    );
    expect(onViewChange).not.toHaveBeenCalledWith("archive");

    const archivedElsewhere = bootstrapWithNoteOne(true);
    archivedElsewhere.data.notes = archivedElsewhere.data.notes.map((note) =>
      note.id === "1" ? { ...note, date: "2099-01-01T00:00:00.000Z" } : note,
    );
    rerender(<NotesWorkspace {...archivedElsewhere} {...props} bootstrapRevision={2} />);

    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith("archive"));
  });
});
