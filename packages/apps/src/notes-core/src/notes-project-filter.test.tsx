import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { Note } from "@/lib/models/note";
import type { NotesAPIOperations, NotesUIData } from "@/lib/models/notes-types";
import { resolveNotesCreateTarget } from "@/notes-core/src/notes-create-target";
import { defaultNotesLabels as L } from "@/notes-core/src/notes-labels";
import {
  canChangeNotebookOwner,
  canDeleteNotebook,
  isProjectOwnedNotebook,
} from "@/notes-core/src/notes-notebook-write";
import {
  notesInProjectNotebooks,
  notesViewOutsideProject,
  projectCreateNotebook,
} from "@/notes-core/src/notes-project-scope";
import { NotesWorkspace } from "@/notes-core/src/notes-workspace";
import { useNotesController } from "@/notes-core/src/use-notes-controller";

let selectedProjectId: string | null = null;
vi.mock("@/lib/projects/use-project-filter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/projects/use-project-filter")>()),
  useSelectedProjectIds: () => (selectedProjectId === null ? null : [selectedProjectId]),
}));

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
vi.mock("@/hooks/use-is-touch", () => ({ useIsTouch: () => false }));
vi.mock("@/app-switch-button/src/app-switch-button", () => ({ AppSwitchButton: () => null }));
vi.mock("@/app-rail/src/app-rail", () => ({ AppRail: () => null }));
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useRouterState: (opts?: {
      select?: (state: { location: { pathname: string } }) => unknown;
    }) => {
      const state = { location: { pathname: "/notes/all" } };
      return opts?.select ? opts.select(state) : state;
    },
    useNavigate: () => vi.fn(),
  };
});

const PROJECT = "proj-website";

function note(id: string, title: string, notebookId: string, notebook: string): Note {
  return {
    id,
    title,
    category: "Note",
    date: "2026-11-01T10:00:00.000Z",
    excerpt: title,
    body: [title],
    notebook,
    notebookId,
    tags: [],
    wordCount: 1,
  };
}

// "Website" is the Project's notebook: the server sends its projectId and mayRename false.
function projectData(): NotesUIData {
  return {
    notes: [
      note("n-personal", "Groceries", "nb-personal", "Personal"),
      note("n-site", "Launch copy", "nb-site", "Website"),
    ],
    notebooks: ["Personal"],
    tags: [],
    notebookCollections: [
      { id: "nb-personal", name: "Personal", isDefault: true, projectId: null },
      {
        id: "nb-site",
        name: "Website",
        scope: "group",
        groupSlug: "studio",
        projectId: PROJECT,
        myRights: { mayWriteAll: true, mayDelete: false, mayRename: false },
      },
    ],
  };
}

const operations = {
  upsertNote: vi.fn(async (n: Note) => n),
  deleteNote: vi.fn(),
  createNotebook: vi.fn(),
  patchNotebook: vi.fn(),
} as unknown as NotesAPIOperations;

beforeEach(() => {
  cleanup();
  selectedProjectId = null;
  window.localStorage.clear();
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
});

describe("Notes project scope helpers", () => {
  const { notes, notebookCollections = [] } = projectData();
  const project = notebookCollections.filter((nb) => nb.projectId === PROJECT);

  it("keeps every note for All Projects and only the Project's notes otherwise", () => {
    expect(notesInProjectNotebooks(notes, null)).toBe(notes);
    expect(notesInProjectNotebooks(notes, project).map((n) => n.id)).toEqual(["n-site"]);
  });

  it("moves an open notebook outside the Project to the Project's notebook", () => {
    expect(notesViewOutsideProject("nb:nb-personal", notebookCollections, project)).toBe(
      "nb:nb-site",
    );
    expect(notesViewOutsideProject("nb:nb-site", notebookCollections, project)).toBeNull();
    expect(notesViewOutsideProject("starred", notebookCollections, project)).toBeNull();
    expect(notesViewOutsideProject("nb:nb-personal", notebookCollections, null)).toBeNull();
    expect(notesViewOutsideProject("nb:nb-personal", notebookCollections, [])).toBe("all");
  });

  it("puts a new note into the Project's notebook outside a notebook view", () => {
    expect(projectCreateNotebook(project)?.id).toBe("nb-site");
    expect(resolveNotesCreateTarget("all", ["Personal"], notebookCollections, project)).toEqual({
      notebook: "Website",
      notebookId: "nb-site",
      scope: "group",
      groupSlug: "studio",
    });
    expect(resolveNotesCreateTarget("all", ["Personal"], notebookCollections, null)).toEqual({
      notebook: "Personal",
    });
    // A selection with no writable notebook falls back to the default.
    expect(resolveNotesCreateTarget("all", ["Personal"], notebookCollections, [])).toEqual({
      notebook: "Personal",
    });
    // A Team filter passes its notebooks as well: the note goes there, not to the hidden default.
    const teamNotebooks = notebookCollections.filter((nb) => nb.projectId);
    expect(
      resolveNotesCreateTarget("all", ["Personal"], notebookCollections, teamNotebooks).notebookId,
    ).toBe(teamNotebooks[0]?.id);
  });

  it("locks rename, owner change and delete on a Project notebook's owner side", () => {
    const site = project[0]!;
    expect(isProjectOwnedNotebook(site)).toBe(true);
    expect(isProjectOwnedNotebook({ ...site, myRights: null, isSharee: true })).toBe(false);
    expect(isProjectOwnedNotebook(notebookCollections[0])).toBe(false);
    expect(canDeleteNotebook({ ...site, myRights: { mayDelete: true } })).toBe(false);
    expect(canChangeNotebookOwner({ ...site, myRights: { mayDelete: true } })).toBe(false);
  });
});

describe("useNotesController with the Project filter", () => {
  it("lists every notebook and note under All Projects", () => {
    const data = projectData();
    const { result } = renderHook(() =>
      useNotesController({ data, operations, initialView: "all" }),
    );
    expect(result.current.notebookCollections.map((nb) => nb.id)).toEqual([
      "nb-personal",
      "nb-site",
    ]);
    expect(result.current.visibleNotes.map((n) => n.id).sort()).toEqual(["n-personal", "n-site"]);
    expect(result.current.canManageNotebooks).toBe(true);
  });

  it("narrows notebooks and notes to the Project and hides New notebook", () => {
    selectedProjectId = PROJECT;
    const data = projectData();
    const { result } = renderHook(() =>
      useNotesController({ data, operations, initialView: "all" }),
    );
    expect(result.current.notebookCollections.map((nb) => nb.id)).toEqual(["nb-site"]);
    expect(result.current.notebooks).toEqual([]);
    expect(result.current.visibleNotes.map((n) => n.id)).toEqual(["n-site"]);
    expect(result.current.canManageNotebooks).toBe(false);
    expect(result.current.canCreateNote).toBe(true);
  });

  it("leaves a notebook outside the Project and closes its open note", async () => {
    selectedProjectId = PROJECT;
    const data = projectData();
    const { result } = renderHook(() =>
      useNotesController({
        data,
        operations,
        initialView: "nb:nb-personal",
        initialNoteId: "n-personal",
      }),
    );
    await waitFor(() => expect(result.current.view).toBe("nb:nb-site"));
    await waitFor(() => expect(result.current.activeId).toBe(""));
  });
});

describe("NotesWorkspace with the Project filter", () => {
  function renderWorkspace() {
    return render(
      <NotesWorkspace
        data={projectData()}
        session={mockWorkspaceSession}
        operations={operations}
        listLoading={false}
        initialView="all"
      />,
    );
  }

  function sidebarRow(name: string): HTMLElement {
    const row = [...document.querySelectorAll<HTMLElement>(".collection-sidebar-row__name")]
      .find((node) => node.textContent === name)
      ?.closest("li");
    if (!row) throw new Error(`no sidebar row for ${name}`);
    return row;
  }

  function hasPencil(row: HTMLElement): boolean {
    return within(row).queryByRole("button", { name: L.edit, hidden: true }) !== null;
  }

  it("shows the edit pencil on ordinary notebooks but not on the Project's notebook", () => {
    renderWorkspace();
    expect(hasPencil(sidebarRow("Personal"))).toBe(true);
    expect(hasPencil(sidebarRow("Website"))).toBe(false);
  });

  it("lists only the Project's notebook and its notes while a Project is selected", () => {
    selectedProjectId = PROJECT;
    renderWorkspace();
    expect(document.querySelectorAll(".collection-sidebar-row__name")).toHaveLength(1);
    expect(hasPencil(sidebarRow("Website"))).toBe(false);
    expect(screen.getAllByText("Launch copy").length).toBeGreaterThan(0);
    expect(screen.queryByText("Groceries")).toBeNull();
  });
});
