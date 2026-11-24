import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNotesProjectScope } from "@/notes-core/src/use-notes-project-scope";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";

let ids: string[] | null = null;
vi.mock("@/lib/projects/use-project-filter", () => ({ useSelectedProjectIds: () => ids }));

const notebookCollections = [
  { id: "nb-personal", name: "Personal", projectId: null },
  { id: "nb-a", name: "A", projectId: "p1" },
  { id: "nb-b", name: "B", projectId: "p2" },
  { id: "nb-x", name: "X", projectId: "p9" },
];

const shell = {
  notebookCollections,
  hiddenNotebookIds: new Set<string>(),
  view: "all",
  setView: vi.fn(),
  canCreateNote: true,
} as unknown as NotesShellState;

const scope = () => renderHook(() => useNotesProjectScope(shell)).result.current;

describe("Notes notebook scope for a Team filter", () => {
  it("shows every Project of the Team and hides the rest", () => {
    ids = ["p1", "p2"];
    const result = scope();
    expect(result.projectNotebooks?.map((n) => n.id)).toEqual(["nb-a", "nb-b"]);
    expect([...result.listShell.hiddenNotebookIds].filter((k) => k.startsWith("nb-"))).toEqual([
      "nb-personal",
      "nb-x",
    ]);
  });
  it("keeps a single Project and All Projects", () => {
    ids = ["p1"];
    expect(scope().projectNotebooks?.map((n) => n.id)).toEqual(["nb-a"]);
    ids = null;
    expect(scope().projectNotebooks).toBeNull();
  });
});
