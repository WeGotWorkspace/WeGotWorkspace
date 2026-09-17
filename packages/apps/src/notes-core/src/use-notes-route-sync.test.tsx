import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notesNavigateTarget } from "@/notes-core/src/notes-route-search";

const navigate = vi.fn();
let mockPathname = "/notes/all";
let mockParams: Record<string, string> = {};

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: mockPathname }),
    useParams: () => mockParams,
  };
});

import { useNotesRouteSync } from "@/notes-core/src/use-notes-route-sync";

describe("useNotesRouteSync", () => {
  beforeEach(() => {
    navigate.mockReset();
    mockPathname = "/notes/all";
    mockParams = {};
  });

  it("pushes All notes note path on handleNoteChange", () => {
    const { result } = renderHook(() => useNotesRouteSync());
    expect(result.current.initialView).toBe("all");

    act(() => {
      result.current.handleNoteChange("n-42");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/all/$noteId",
      params: { noteId: "n-42" },
      replace: false,
    });
  });

  it("pushes Starred note path on handleNoteChange", () => {
    mockPathname = "/notes/starred";
    const { result } = renderHook(() => useNotesRouteSync());
    expect(result.current.initialView).toBe("starred");

    act(() => {
      result.current.handleNoteChange("n-7");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/starred/$noteId",
      params: { noteId: "n-7" },
      replace: false,
    });
  });

  it("pushes Archive note path on handleNoteChange", () => {
    mockPathname = "/notes/archive";
    const { result } = renderHook(() => useNotesRouteSync());

    act(() => {
      result.current.handleNoteChange("n-9");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/archive/$noteId",
      params: { noteId: "n-9" },
      replace: false,
    });
  });

  it("pushes shared-with-me note path on handleNoteChange", () => {
    mockPathname = "/notes/shared-with-me";
    const { result } = renderHook(() => useNotesRouteSync());
    expect(result.current.initialView).toBe("shared-with-me");

    act(() => {
      result.current.handleNoteChange("swm-note-1");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/shared-with-me/$noteId",
      params: { noteId: "swm-note-1" },
      replace: false,
    });
  });

  it("pushes local temp note ids so offline rows update the path", () => {
    const { result } = renderHook(() => useNotesRouteSync());

    act(() => {
      result.current.handleNoteChange("local-9a8c070a270341c394678504240799ee");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/all/$noteId",
      params: { noteId: "local-9a8c070a270341c394678504240799ee" },
      replace: false,
    });
  });

  it("skips navigate when the note id is already current", () => {
    mockPathname = "/notes/all";
    mockParams = { noteId: "n-1" };
    const { result } = renderHook(() => useNotesRouteSync());

    act(() => {
      result.current.handleNoteChange("n-1");
    });

    expect(navigate).not.toHaveBeenCalled();
  });

  it("replaces when clearing the note id", () => {
    mockPathname = "/notes/all";
    mockParams = { noteId: "n-1" };
    const { result } = renderHook(() => useNotesRouteSync());

    act(() => {
      result.current.handleNoteChange("");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/all",
      params: {},
      replace: true,
    });
  });

  it("keeps filter view after handleViewChange then handleNoteChange", () => {
    const { result } = renderHook(() => useNotesRouteSync());

    act(() => {
      result.current.handleViewChange("starred");
    });
    act(() => {
      result.current.handleNoteChange("n-1");
    });

    expect(navigate).toHaveBeenLastCalledWith({
      to: "/notes/starred/$noteId",
      params: { noteId: "n-1" },
      replace: false,
    });
  });

  it("keeps the current note on the destination notebook path when the view follows a move", () => {
    mockPathname = "/notes/notebooks/notes-drafts/n-1";
    mockParams = { notebookId: "notes-drafts", noteId: "n-1" };
    const { result } = renderHook(() => useNotesRouteSync());
    expect(result.current.initialView).toBe("nb:notes-drafts");
    expect(result.current.initialNoteId).toBe("n-1");

    act(() => {
      result.current.handleViewChange("nb:notes-work");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/notes/notebooks/$notebookId/$noteId",
      params: { notebookId: "notes-work", noteId: "n-1" },
      replace: true,
    });
  });

  it("lands on All Items after switching from Starred then opening the new note", () => {
    mockPathname = "/notes/starred";
    const { result } = renderHook(() => useNotesRouteSync());

    act(() => {
      result.current.handleViewChange("all");
    });
    act(() => {
      result.current.handleNoteChange("local-new");
    });

    expect(navigate).toHaveBeenNthCalledWith(1, {
      to: "/notes/all",
      params: {},
      replace: true,
    });
    expect(navigate).toHaveBeenLastCalledWith({
      to: "/notes/all/$noteId",
      params: { noteId: "local-new" },
      replace: false,
    });
  });
});

describe("notesNavigateTarget filter views", () => {
  it("keeps note id for every primary filter view", () => {
    for (const view of ["all", "starred", "archive", "shared-with-me"] as const) {
      expect(notesNavigateTarget(view, "n-1").to).toContain("$noteId");
      expect(notesNavigateTarget(view, "n-1").params.noteId).toBe("n-1");
    }
  });

  it("preserves note id for unknown views instead of dropping selection", () => {
    expect(notesNavigateTarget("mystery", "n-1")).toEqual({
      to: "/notes/all/$noteId",
      params: { noteId: "n-1" },
    });
  });
});
