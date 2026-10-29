import { describe, expect, it } from "vitest";
import {
  notesNavigateTarget,
  notesNoteFromParams,
  notesViewFromLocation,
} from "@/notes-core/src/notes-route-search";

describe("notes-route-search", () => {
  it("maps primary views and optional note id from path params", () => {
    expect(notesViewFromLocation("/notes/all", {})).toBe("all");
    expect(notesViewFromLocation("/notes/starred", {})).toBe("starred");
    expect(notesViewFromLocation("/notes/archive", {})).toBe("archive");
    expect(notesNoteFromParams({})).toBe("");
    expect(notesNoteFromParams({ noteId: "n-123" })).toBe("n-123");
  });

  it("maps tag and notebook paths to controller view keys", () => {
    expect(
      notesViewFromLocation("/notes/tags/focus", {
        tagSlug: "focus",
      }),
    ).toBe("tag:focus");
    expect(
      notesViewFromLocation("/notes/notebooks/notes-drafts", {
        notebookId: "notes-drafts",
      }),
    ).toBe("nb:notes-drafts");
    expect(
      notesViewFromLocation("/notes/notebooks/My%20Notebook", {
        notebookId: "My%20Notebook",
      }),
    ).toBe("nb:My Notebook");
  });

  it("builds navigation targets from controller view state", () => {
    expect(notesNavigateTarget("all")).toEqual({ to: "/notes/all", params: {} });
    expect(notesNavigateTarget("all", "n-1")).toEqual({
      to: "/notes/all/$noteId",
      params: { noteId: "n-1" },
    });
    expect(notesNavigateTarget("archive", "n-2")).toEqual({
      to: "/notes/archive/$noteId",
      params: { noteId: "n-2" },
    });
    expect(notesNavigateTarget("nb:notes-drafts", "n-3")).toEqual({
      to: "/notes/notebooks/$notebookId/$noteId",
      params: { notebookId: "notes-drafts", noteId: "n-3" },
    });
    expect(notesNavigateTarget("tag:work")).toEqual({
      to: "/notes/tags/$tagSlug",
      params: { tagSlug: "work" },
    });
    expect(notesNavigateTarget("shared-with-me")).toEqual({
      to: "/notes/shared-with-me",
      params: {},
    });
    expect(notesNavigateTarget("shared-nb:/users/bob/.notes/TeamPad", "n-9")).toEqual({
      to: "/notes/shared-nb/$sharedNbSlug/$noteId",
      params: {
        sharedNbSlug: encodeURIComponent("/users/bob/.notes/TeamPad"),
        noteId: "n-9",
      },
    });
  });

  it("maps shared-with-me and shared notebook paths", () => {
    expect(notesViewFromLocation("/notes/shared-with-me", {})).toBe("shared-with-me");
    expect(
      notesViewFromLocation("/notes/shared-nb/%2Fusers%2Fbob%2F.notes%2FTeamPad", {
        sharedNbSlug: encodeURIComponent("/users/bob/.notes/TeamPad"),
      }),
    ).toBe("shared-nb:/users/bob/.notes/TeamPad");
  });

  // #1752: mid-navigation the pathname is new but params still belong to the
  // previous route (e.g. /notes/starred has no tagSlug).
  it("reads tag and shared notebook slugs from the path when params are stale", () => {
    expect(notesViewFromLocation("/notes/tags/focus", {})).toBe("tag:focus");
    expect(notesViewFromLocation("/notes/tags/focus/n-1", { noteId: "n-1" })).toBe("tag:focus");
    expect(notesViewFromLocation("/notes/tags/next", { tagSlug: "focus" })).toBe("tag:next");
    expect(
      notesViewFromLocation("/notes/shared-nb/%252Fusers%252Fbob%252F.notes%252FTeamPad", {}),
    ).toBe("shared-nb:/users/bob/.notes/TeamPad");
  });

  it("decodes tag slugs the router encoded twice", () => {
    // notesNavigateTarget encodes the tag, the router encodes the param again.
    expect(notesViewFromLocation("/notes/tags/my%2520tag", {})).toBe("tag:my tag");
    expect(notesViewFromLocation("/notes/tags/50%2525", {})).toBe("tag:50%");
    // A hand-typed URL with a single encoding still works.
    expect(notesViewFromLocation("/notes/tags/my%20tag", {})).toBe("tag:my tag");
  });

  it("does not let a notebook named Starred take over /notes/starred", () => {
    expect(notesViewFromLocation("/notes/starred", {})).toBe("starred");
    expect(notesViewFromLocation("/notes/archive", {})).toBe("archive");
    expect(notesViewFromLocation("/notes/all", {})).toBe("all");
    expect(notesNavigateTarget("starred")).toEqual({ to: "/notes/starred", params: {} });
    expect(notesNavigateTarget("nb:starred")).toEqual({
      to: "/notes/notebooks/$notebookId",
      params: { notebookId: "starred" },
    });
    expect(notesNavigateTarget("nb:Starred")).toEqual({
      to: "/notes/notebooks/$notebookId",
      params: { notebookId: "Starred" },
    });
    expect(notesViewFromLocation("/notes/notebooks/starred", { notebookId: "starred" })).toBe(
      "nb:starred",
    );
    expect(notesViewFromLocation("/notes/starred", { notebookId: "starred" })).toBe("starred");
  });
});
