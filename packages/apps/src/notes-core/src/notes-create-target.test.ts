/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { writeDefaultCollectionPrefs } from "@/lib/default-collection-prefs";
import { resolveNotesCreateTarget } from "@/notes-core/src/notes-create-target";
import { notesViewForCreate } from "@/notes-core/src/notes-note-utils";

describe("resolveNotesCreateTarget", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("uses the stored notebook when All Items is selected", () => {
    writeDefaultCollectionPrefs("notes", { collectionId: "The Journal" });
    expect(resolveNotesCreateTarget("all", ["Drafts", "The Journal"])).toEqual({
      notebook: "The Journal",
    });
    expect(resolveNotesCreateTarget("nb:Drafts", ["Drafts", "The Journal"])).toEqual({
      notebook: "Drafts",
      notebookId: "Drafts",
    });
    expect(
      resolveNotesCreateTarget(notesViewForCreate("starred"), ["Drafts", "The Journal"]),
    ).toEqual({ notebook: "The Journal" });
  });

  it("falls back to the first personal notebook when the stored name is gone", () => {
    writeDefaultCollectionPrefs("notes", { collectionId: "Missing" });
    expect(resolveNotesCreateTarget("all", ["Drafts", "The Journal"])).toEqual({
      notebook: "Drafts",
    });
  });

  it("returns the collection id and display name for an nb view", () => {
    expect(
      resolveNotesCreateTarget("nb:drafts", ["Drafts"], [{ id: "drafts", name: "Drafts" }]),
    ).toEqual({ notebook: "Drafts", notebookId: "drafts" });
  });

  it("returns group scope for a team notebook id", () => {
    expect(
      resolveNotesCreateTarget(
        "nb:group-eng",
        ["Drafts"],
        [{ id: "group-eng", name: "Engineering", scope: "group", groupSlug: "eng" }],
      ),
    ).toEqual({
      notebook: "Engineering",
      notebookId: "group-eng",
      scope: "group",
      groupSlug: "eng",
    });
  });

  it("uses the view key as notebook and notebookId when no collection matches", () => {
    expect(resolveNotesCreateTarget("nb:missing-id", ["Drafts"])).toEqual({
      notebook: "missing-id",
      notebookId: "missing-id",
    });
  });
});
