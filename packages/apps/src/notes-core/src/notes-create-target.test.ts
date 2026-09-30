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
});
